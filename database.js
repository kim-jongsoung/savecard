const { Pool } = require('pg');
require('dotenv').config();

// Railway PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 데이터베이스 테이블 초기화
async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        // 제휴업체 테이블
        await client.query(`
            CREATE TABLE IF NOT EXISTS stores (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(100),
                discount_info TEXT,
                is_active BOOLEAN DEFAULT true,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 카드 테이블
        await client.query(`
            CREATE TABLE IF NOT EXISTS cards (
                id SERIAL PRIMARY KEY,
                token VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                birth_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 카드 사용 내역 테이블
        await client.query(`
            CREATE TABLE IF NOT EXISTS card_usage (
                id SERIAL PRIMARY KEY,
                card_token VARCHAR(255) NOT NULL,
                store_name VARCHAR(255) NOT NULL,
                discount_info TEXT,
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 제휴업체 신청 테이블
        await client.query(`
            CREATE TABLE IF NOT EXISTS partner_applications (
                id SERIAL PRIMARY KEY,
                business_name VARCHAR(255) NOT NULL,
                contact_name VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                email VARCHAR(255),
                business_type VARCHAR(100),
                address TEXT,
                description TEXT,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ 데이터베이스 테이블 초기화 완료');

        // 기존 JSON 데이터가 있다면 마이그레이션
        await migrateExistingData(client);

    } catch (error) {
        console.error('❌ 데이터베이스 초기화 오류:', error);
    } finally {
        client.release();
    }
}

// 기존 JSON 데이터 마이그레이션
async function migrateExistingData(client) {
    try {
        const fs = require('fs');
        const path = require('path');

        // stores.json 마이그레이션
        const storesPath = path.join(__dirname, 'data', 'stores.json');
        if (fs.existsSync(storesPath)) {
            const storesData = JSON.parse(fs.readFileSync(storesPath, 'utf8'));
            
            for (const store of storesData) {
                await client.query(`
                    INSERT INTO stores (name, category, discount_info, is_active, usage_count)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT DO NOTHING
                `, [
                    store.name,
                    store.category || '',
                    store.discount_info,
                    store.is_active !== false,
                    store.usage_count || 0
                ]);
            }
            console.log('✅ 제휴업체 데이터 마이그레이션 완료');
        }

        // cards.json 마이그레이션
        const cardsPath = path.join(__dirname, 'data', 'cards.json');
        if (fs.existsSync(cardsPath)) {
            const cardsData = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
            
            for (const card of cardsData) {
                await client.query(`
                    INSERT INTO cards (token, name, phone, birth_date)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (token) DO NOTHING
                `, [
                    card.token,
                    card.name,
                    card.phone,
                    card.birth_date ? new Date(card.birth_date) : null
                ]);
            }
            console.log('✅ 카드 데이터 마이그레이션 완료');
        }

    } catch (error) {
        console.log('ℹ️ 기존 데이터 마이그레이션 건너뜀:', error.message);
    }
}

module.exports = {
    pool,
    initializeDatabase
};
