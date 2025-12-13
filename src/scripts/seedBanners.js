const mongoose = require('mongoose');
const Banner = require('../models/Banner');

const seedBanners = async () => {
    try {
        await mongoose.connect('mongodb+srv://urbanprox:URbanProx556677@urbanprox.hgd4ssb.mongodb.net/');
        console.log('Connected to MongoDB');

        // Clear existing banners
        await Banner.deleteMany({});
        console.log('Cleared existing banners');

        // Create 5 promotional banners with actual sale/promotional graphics
        // Using images with promotional text and designs
        const banners = [
            {
                title: 'Grand Opening Sale',
                description: 'Flat 50% OFF on all services! Limited time offer.',
                // Promotional sale banner with text
                image: 'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1200&h=500&fit=crop',
                position: 'home_top',
                order: 1,
                isActive: false,
                linkType: 'category'
            },
            {
                title: 'Summer Special Offer',
                description: 'Get AC service at ₹499 only. Beat the heat!',
                // Colorful promotional design
                image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&h=500&fit=crop',
                position: 'home_top',
                order: 2,
                isActive: false,
                linkType: 'category'
            },
            {
                title: 'New Customer Bonus',
                description: 'First booking? Get 30% OFF on any service!',
                // Vibrant promotional banner
                image: 'https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=1200&h=500&fit=crop',
                position: 'home_top',
                order: 3,
                isActive: false,
                linkType: 'category'
            },
            {
                title: 'Weekend Flash Sale',
                description: 'Book now and save big! All home services available.',
                // Eye-catching promotional design
                image: 'https://images.unsplash.com/photo-1607083206325-caf1edba7a0f?w=1200&h=500&fit=crop',
                position: 'home_top',
                order: 4,
                isActive: false,
                linkType: 'category'
            },
            {
                title: 'Refer & Earn Rewards',
                description: 'Invite friends and get ₹500 cashback on every referral!',
                // Promotional reward banner
                image: 'https://images.unsplash.com/photo-1607082350899-7e105aa886ae?w=1200&h=500&fit=crop',
                position: 'home_top',
                order: 5,
                isActive: false,
                linkType: 'category'
            }
        ];

        // Insert banners
        const createdBanners = await Banner.insertMany(banners);

        console.log('\n========================================');
        console.log('🎉 PROMOTIONAL BANNER SEEDING COMPLETE!');
        console.log('========================================');
        console.log(`📢 Total Banners Created: ${createdBanners.length}`);
        console.log(`✅ Published Banners: ${createdBanners.filter(b => b.isActive).length}`);
        console.log(`❌ Unpublished Banners: ${createdBanners.filter(b => !b.isActive).length}`);
        console.log('========================================');
        console.log('ℹ️  All banners are UNPUBLISHED by default');
        console.log('ℹ️  Admin can publish them from the admin panel');
        console.log('ℹ️  Promotional sale banner images (1200x500)');
        console.log('========================================\n');

        createdBanners.forEach((banner, index) => {
            console.log(`${index + 1}. ${banner.title}`);
            console.log(`   Image: ${banner.image}`);
            console.log(`   Status: ${banner.isActive ? '✅ Published' : '❌ Unpublished'}`);
            console.log('');
        });

        await mongoose.connection.close();
        console.log('Database connection closed');
    } catch (error) {
        console.error('❌ Error seeding banners:', error);
        process.exit(1);
    }
};

seedBanners();
