const mongoose = require('mongoose');

let isConnected = false;

const connectMongoDB = async () => {
    if (isConnected) {
        console.log('✅ MongoDB 이미 연결됨');
        return;
    }

    try {
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/guamsavecard';
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        isConnected = true;
        console.log('✅ MongoDB 연결 성공:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));

        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB 연결 오류:', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB 연결 끊김');
            isConnected = false;
        });

    } catch (error) {
        console.error('❌ MongoDB 연결 실패:', error.message);
        isConnected = false;
        throw error;
    }
};

module.exports = { connectMongoDB, mongoose };
