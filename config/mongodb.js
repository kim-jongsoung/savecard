const mongoose = require('mongoose');

let isConnected = false;

const connectMongoDB = async () => {
    if (isConnected) {
        console.log('✅ MongoDB 이미 연결됨');
        return;
    }

    try {
        // Railway는 MONGO_URL을 사용, 우리는 MONGODB_URI를 선호
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/guamsavecard';
        
        // 디버깅: 환경변수 확인
        console.log('🔍 MongoDB 연결 시도...');
        console.log('🔍 MONGODB_URI 환경변수:', process.env.MONGODB_URI ? '✅ 설정됨' : '❌ 미설정');
        console.log('🔍 MONGO_URL 환경변수:', process.env.MONGO_URL ? '✅ 설정됨' : '❌ 미설정');
        console.log('🔍 사용할 URI:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));
        
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
