const Booking = require('../models/Booking');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const { db, admin, messager } = require('../config/firebase'); // Import Messaging

// Helper: Send Push Notification
const sendNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;
  try {
    await messager.send({
      token: fcmToken,
      notification: { title, body },
      data: data, // Custom data for app routing
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } }
    });
    console.log('🔔 Notification sent:', title);
  } catch (error) {
    console.error('❌ Notification Failed:', error.message);
  }
};

// Helper function for smart assignment
// Helper function for smart assignment
async function assignNextVendor(bookingId, io) {
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) return;

    const { candidateVendors, candidateIndex } = booking;

    if (candidateIndex >= candidateVendors.length) {
      booking.status = 'no_vendor_available';
      await booking.save();
      return;
    }

    const vendorId = candidateVendors[candidateIndex];
    const expiresAt = new Date(Date.now() + 60000); // 1 minute from now

    booking.vendor = vendorId;
    booking.status = 'waiting_vendor_response';
    booking.vendorOfferExpiresAt = expiresAt;
    await booking.save();

    // Notify Vendor via Socket
    if (io) {
      console.log(`Emitting new_booking_request to vendor_${vendorId}`);
      io.to(`vendor_${vendorId}`).emit('new_booking_request', {
        bookingId: booking._id,
        serviceName: booking.serviceName,
        customerName: booking.customerName,
        amount: booking.totalAmount,
        location: booking.customerLocation,
        expiresAt: expiresAt.toISOString()
      });
    }

    // 🔥 Sync to Firebase Firestore (Realtime)
    try {
      await db.collection('active_bookings').doc(booking._id.toString()).set({
        status: booking.status,
        vendorId: vendorId.toString(),
        vendorOfferExpiresAt: expiresAt.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 🔔 Send Push Notification to Vendor
      const vendor = await Vendor.findById(vendorId);
      if (vendor && vendor.fcmToken) {
        await sendNotification(
          vendor.fcmToken,
          'New Booking Request! 🚨',
          `New ${booking.serviceName} job nearby. Tap to accept!`,
          { bookingId: booking._id.toString(), type: 'new_booking' }
        );
      }

    } catch (err) {
      console.error('🔥 Firestore Sync Error (assignNextVendor):', err.message);
    }
  } catch (error) {
    console.error('assignNextVendor error:', error);
  }
}

// GET /api/bookings/active
exports.getActiveBookings = async (req, res, next) => {
  try {
    const activeStatuses = ['pending', 'accepted', 'confirmed', 'on_the_way', 'arrived', 'work_started', 'waiting_vendor_response'];

    let query = {};
    if (req.role === 'vendor') {
      query = { vendor: req.user._id, status: { $in: activeStatuses } };
    } else {
      // Default to user if not vendor (or explicitly user)
      query = { user: req.user._id, status: { $in: activeStatuses } };
    }

    let bookings = await Booking.find(query)
      .populate('user', 'name phone') // Populate user details for vendor
      .populate('vendor', 'name phone') // Populate vendor details for user
      .sort({ createdAt: -1 });

    // Lazy Expiration Check
    const now = new Date();
    const updatedBookings = [];
    let hasUpdates = false;

    for (let booking of bookings) {
      if (booking.status === 'waiting_vendor_response' && booking.vendorOfferExpiresAt && now > new Date(booking.vendorOfferExpiresAt)) {
        // Expired! Auto-assign to next vendor
        booking.rejectedVendors.push(booking.vendor);

        const nextIndex = booking.candidateIndex + 1;
        if (nextIndex < booking.candidateVendors.length) {
          // Auto-assign to next vendor
          booking.candidateIndex = nextIndex;
          await booking.save();

          const io = req.app.get('io');
          await assignNextVendor(booking._id, io);
          hasUpdates = true;

          // Re-fetch updated booking
          booking = await Booking.findById(booking._id).populate('user vendor');
        } else {
          booking.status = 'no_vendor_available';
          await booking.save();
          hasUpdates = true;
        }

        // Don't include in active list for vendor if it's now assigned to someone else
        if (req.role === 'vendor') continue;
      }
      updatedBookings.push(booking);
    }

    if (hasUpdates) {
      // If we updated statuses, we might want to re-fetch or just return the filtered list
      // For simplicity, returning the filtered list (updatedBookings)
      bookings = updatedBookings;
    }

    res.json({ success: true, data: bookings, message: 'Active bookings loaded' });
  } catch (err) {
    next(err);
  }
};

// GET /api/bookings/completed?page=&limit=
exports.getCompletedBookings = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const pastStatuses = ['work_completed', 'cancelled', 'rejected', 'rejected_by_vendor', 'cancelled_by_user', 'no_vendor_available'];

    let query = {};
    if (req.role === 'vendor') {
      query = {
        $or: [
          { vendor: req.user._id, status: { $in: pastStatuses } },
          { rejectedVendors: req.user._id }
        ]
      };
    } else {
      query = { user: req.user._id, status: { $in: pastStatuses } };
    }

    const [items, total] = await Promise.all([
      Booking.find(query)
        .populate('user', 'name phone')
        .populate('vendor', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        data: items,
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      },
      message: 'Completed bookings loaded',
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/bookings/:id
exports.getBookingById = async (req, res, next) => {
  try {
    const query = req.role === 'vendor'
      ? { _id: req.params.id, vendor: req.user._id }
      : { _id: req.params.id, user: req.user._id };

    const booking = await Booking.findOne(query);

    if (!booking) {
      res.status(404);
      return res.json({ success: false, data: null, message: 'Booking not found' });
    }

    res.json({ success: true, data: booking, message: 'Booking loaded' });
  } catch (err) {
    next(err);
  }
};

// POST /api/bookings (Create Booking - User only)
exports.createBooking = async (req, res, next) => {
  try {
    if (req.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only users can create bookings' });
    }

    const { serviceId, date, time, scheduledDate, scheduledTime, address, customerLocation: reqLocation, totalAmount, items, paymentMethod, paymentStatus } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Fetch full user details to populate booking
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Construct customerLocation
    let finalCustomerLocation = {};
    if (reqLocation) {
      finalCustomerLocation = reqLocation;
    } else if (typeof address === 'string') {
      finalCustomerLocation = {
        address: address,
      };
    } else if (typeof address === 'object') {
      finalCustomerLocation = address;
    }

    // SMART BOOKING: Find Candidates
    // Only fetch VERIFIED, ONLINE, and NON-BLOCKED vendors
    const candidates = await Vendor.find({
      isOnline: true,
      isVerified: true,  // ✅ Only verified vendors
      isBlocked: false   // ✅ Not blocked vendors
    }).select('_id avgRating');

    // Sort by rating (simplified score)
    candidates.sort((a, b) => b.avgRating - a.avgRating);
    let candidateIds = candidates.map(c => c._id.toString());

    // If a specific vendor was requested, prioritize them (only if verified)
    const requestedVendorId = req.body.vendorId || req.body.vendor;
    if (requestedVendorId) {
      // Check if requested vendor is verified
      const requestedVendor = await Vendor.findById(requestedVendorId);
      if (requestedVendor && requestedVendor.isVerified && !requestedVendor.isBlocked) {
        // Move requested vendor to the front
        candidateIds = candidateIds.filter(id => id !== requestedVendorId);
        candidateIds.unshift(requestedVendorId);
      }
    }

    if (candidateIds.length === 0) {
      return res.status(404).json({ success: false, message: 'No verified vendors available at the moment' });
    }

    const booking = await Booking.create({
      user: req.user._id,
      // vendor: candidateIds[0], // Will be set by assignNextVendor
      candidateVendors: candidateIds,
      candidateIndex: 0,
      customerName: user.name || 'Unknown User',
      customerPhone: user.phone,
      customerLocation: finalCustomerLocation,
      serviceName: items && items.length > 0 ? items[0].name : 'Service',
      serviceId,
      items,
      scheduledDate: scheduledDate || date,
      scheduledTime: scheduledTime || time,
      serviceDateTime: new Date(`${scheduledDate || date} ${scheduledTime || time}`),
      serviceDurationMinutes: 60, // Default or from service
      totalAmount,
      status: 'searching_vendor', // Initial status
      paymentMethod: paymentMethod || 'cod',
      paymentStatus: paymentStatus || 'pending'
    });

    // Trigger assignment
    const io = req.app.get('io');
    await assignNextVendor(booking._id, io);

    // Fetch updated booking
    const updatedBooking = await Booking.findById(booking._id).populate('vendor');

    // 🔥 Sync initial booking to Firebase
    try {
      await db.collection('active_bookings').doc(booking._id.toString()).set({
        bookingId: booking._id.toString(),
        customerId: req.user._id.toString(),
        customerName: user.name || 'Unknown',
        serviceName: booking.serviceName,
        status: 'searching_vendor',
        location: finalCustomerLocation,
        totalAmount: totalAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.error('🔥 Firestore Sync Error (createBooking):', err.message);
    }

    res.status(201).json({ success: true, data: updatedBooking, message: 'Booking created, searching for vendor' });
  } catch (err) {
    console.error('createBooking error:', err);
    next(err);
  }
};

// GET /api/bookings/user/:userId (Get User Bookings)
// GET /api/bookings/user/:userId (Get User Bookings)
exports.getUserBookings = async (req, res, next) => {
  try {
    // Strictly allow users to only see their own bookings
    // If the param is 'me', use the authenticated user's ID
    // If the param is a specific ID, it MUST match the authenticated user's ID
    const targetUserId = req.params.userId === 'me' ? req.user._id.toString() : req.params.userId;

    if (req.user._id.toString() !== targetUserId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to bookings' });
    }

    const bookings = await Booking.find({ user: req.user._id })
      .populate('vendor', 'name phone profileImage avgRating')
      .populate('proposedVendorId', 'name phone profileImage avgRating')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: bookings });
  } catch (err) {
    next(err);
  }
};


// POST /api/bookings/:id/accept
// POST /api/bookings/:id/accept
exports.acceptBooking = async (req, res, next) => {
  req.body.action = 'accept';
  return exports.vendorResponse(req, res, next);
};

// POST /api/bookings/:id/vendor-response
exports.vendorResponse = async (req, res, next) => {
  try {
    const { action } = req.body; // 'accept' or 'reject'
    const booking = await Booking.findOne({ _id: req.params.id, vendor: req.user._id });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'waiting_vendor_response' && booking.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Booking is not waiting for response' });
    }

    if (booking.status === 'waiting_vendor_response' && new Date() > new Date(booking.vendorOfferExpiresAt)) {
      return res.status(409).json({ success: false, message: 'Request expired' });
    }

    const io = req.app.get('io');

    if (action === 'accept') {
      booking.status = 'confirmed';
      await booking.save();

      // Notify User
      io.to(`user_${booking.user}`).emit('booking_accepted', {
        bookingId: booking._id,
        vendorName: req.user.name,
        vendorPhone: req.user.phone
      });

      res.json({ success: true, data: booking, message: 'Booking accepted' });

      // 🔥 Sync Accept to Firebase
      try {
        await db.collection('active_bookings').doc(booking._id.toString()).update({
          status: 'confirmed',
          vendorId: req.user._id.toString(),
          vendorName: req.user.name,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 🔔 Notify User via Push
        const user = await User.findById(booking.user);
        if (user && user.fcmToken) {
          await sendNotification(
            user.fcmToken,
            'Vendor Found! 🎉',
            `${req.user.name} has accepted your ${booking.serviceName} request.`,
            { bookingId: booking._id.toString(), type: 'booking_accepted' }
          );
        }
      } catch (err) { }
    } else {
      // Reject - Ask user to approve next vendor
      booking.rejectedVendors.push(req.user._id);

      // Prepare for user approval of next vendor
      const nextIndex = booking.candidateIndex + 1;
      if (nextIndex < booking.candidateVendors.length) {
        const nextVendorId = booking.candidateVendors[nextIndex];
        booking.status = 'waiting_user_approval';
        booking.proposedVendorId = nextVendorId;
        booking.userApprovalExpiresAt = new Date(Date.now() + 120000); // 2 minutes for user to decide
        booking.candidateIndex = nextIndex;
        await booking.save();

        // Populate the proposed vendor details for the response
        const updatedBooking = await Booking.findById(booking._id)
          .populate('proposedVendorId', 'name phone profileImage avgRating');

        // Notify User to approve next vendor
        io.to(`user_${booking.user}`).emit('vendor_approval_needed', {
          bookingId: booking._id,
          proposedVendor: updatedBooking.proposedVendorId,
          message: 'Previous vendor was unavailable. Would you like to try another vendor?'
        });

        res.json({ success: true, data: updatedBooking, message: 'Waiting for user approval of next vendor' });
      } else {
        // No more vendors available
        booking.status = 'no_vendor_available';
        await booking.save();

        // Notify User
        io.to(`user_${booking.user}`).emit('no_vendor_available', {
          bookingId: booking._id,
          message: 'No vendors available for your booking'
        });

        res.json({ success: true, data: booking, message: 'No vendors available' });
      }
    }
  } catch (err) {
    next(err);
  }
};

// POST /api/bookings/:id/user-approval
exports.userApproval = async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'waiting_user_approval') {
      return res.status(400).json({ success: false, message: 'Booking is not waiting for approval' });
    }

    if (new Date() > new Date(booking.userApprovalExpiresAt)) {
      // Auto-reject/cancel if expired
      booking.status = 'cancelled_by_user';
      await booking.save();
      return res.json({ success: true, data: booking, message: 'Approval time expired, request cancelled' });
    }

    if (action === 'approve') {
      // User approved the proposed vendor
      // Call assignNextVendor logic directly to send request to the new vendor
      const io = req.app.get('io');
      await assignNextVendor(booking._id, io);

      const updatedBooking = await Booking.findById(booking._id);
      res.json({ success: true, data: updatedBooking, message: 'Vendor approved, sending request' });
    } else if (action === 'reject') {
      booking.status = 'cancelled_by_user';
      await booking.save();
      res.json({ success: true, data: booking, message: 'Booking cancelled' });
    }
  } catch (err) {
    next(err);
  }
};

// Keep existing rejectBooking for backward compatibility or admin use if needed
exports.rejectBooking = async (req, res, next) => {
  // ... existing implementation ...
  // For now, redirect to vendorResponse with action='reject'
  req.body.action = 'reject';
  return exports.vendorResponse(req, res, next);
};

// PATCH /api/bookings/:id/status
exports.updateBookingStatus = async (req, res, next) => {
  try {
    const { status, location } = req.body;

    const allowedStatuses = [
      'pending',
      'accepted',
      'on_the_way',
      'arrived',
      'work_started',
      'work_completed',
      'cancelled',
      'rejected',
    ];

    if (!allowedStatuses.includes(status)) {
      res.status(400);
      return res.json({ success: false, data: null, message: 'Invalid status' });
    }

    const update = { status };
    if (location) {
      update.vendorLocation = location;
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, vendor: req.user._id },
      update,
      { new: true }
    );

    if (!booking) {
      res.status(404);
      return res.json({ success: false, data: null, message: 'Booking not found' });
    }

    res.json({ success: true, data: booking, message: 'Status updated' });
  } catch (err) {
    next(err);
  }
};

// The following endpoints are stubs so your frontend APIs succeed;
// you can expand them later as needed.

// POST /api/bookings/:id/additional-charges
exports.addAdditionalCharges = async (req, res, next) => {
  try {
    const { charges } = req.body;

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, vendor: req.user._id },
      { $push: { additionalCharges: { $each: charges || [] } } },
      { new: true }
    );

    if (!booking) {
      res.status(404);
      return res.json({ success: false, data: null, message: 'Booking not found' });
    }

    res.json({ success: true, data: booking, message: 'Additional charges added' });
  } catch (err) {
    next(err);
  }
};

// POST /api/bookings/:id/work-images
exports.uploadWorkImages = async (req, res, next) => {
  try {
    const { images } = req.body;

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, vendor: req.user._id },
      { $push: { workImages: { $each: images || [] } } },
      { new: true }
    );

    if (!booking) {
      res.status(404);
      return res.json({ success: false, data: null, message: 'Booking not found' });
    }

    res.json({ success: true, data: booking, message: 'Work images uploaded' });
  } catch (err) {
    next(err);
  }
};

// POST /api/bookings/:id/signature
exports.addCustomerSignature = async (req, res, next) => {
  try {
    const { signature } = req.body;

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, vendor: req.user._id },
      { customerSignature: signature },
      { new: true }
    );

    if (!booking) {
      res.status(404);
      return res.json({ success: false, data: null, message: 'Booking not found' });
    }

    res.json({ success: true, data: booking, message: 'Customer signature saved' });
  } catch (err) {
    next(err);
  }
};
