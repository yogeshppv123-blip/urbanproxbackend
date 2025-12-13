const mongoose = require('mongoose');
const Category = require('../models/Category');
require('dotenv').config();

async function listCategories() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/urbanprox');
        console.log('✅ Connected to MongoDB');

        const categories = await Category.find({}).select('name level parentCategory');

        console.log('\n📋 Existing Categories:');
        console.log('─'.repeat(60));
        categories.forEach(cat => {
            console.log(`${cat.name.padEnd(30)} | Level: ${cat.level}`);
        });
        console.log('─'.repeat(60));
        console.log(`Total: ${categories.length} categories`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

listCategories();
