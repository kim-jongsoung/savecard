#!/usr/bin/env node

/**
 * 괌세이브카드 데이터베이스 컬럼명 확인 스크립트
 * 실제 reservations 테이블의 컬럼명을 확인하여 일관성 검증
 */

const { Pool } = require('pg');

// Railway PostgreSQL 연결
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkColumns() {
    try {
        console.log('🔍 괌세이브카드 데이터베이스 컬럼 확인 시작...');
        
        // 연결 테스트
        await pool.query('SELECT NOW()');
        console.log('✅ 데이터베이스 연결 성공');
        
        // reservations 테이블 컬럼 조회
        const columnsQuery = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'reservations' 
            AND table_schema = 'public'
            ORDER BY ordinal_position
        `;
        
        const result = await pool.query(columnsQuery);
        
        console.log('\n📋 reservations 테이블 컬럼 목록:');
        console.log('=' .repeat(80));
        
        const columns = result.rows;
        columns.forEach((col, index) => {
            console.log(`${(index + 1).toString().padStart(2)}. ${col.column_name.padEnd(25)} | ${col.data_type.padEnd(20)} | ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        console.log('=' .repeat(80));
        console.log(`총 ${columns.length}개 컬럼`);
        
        // 중요한 컬럼들 확인
        const importantColumns = [
            'korean_name',
            'english_first_name', 
            'english_last_name',
            'usage_date',
            'usage_time',
            'people_adult',
            'people_child', 
            'people_infant',
            'adults',
            'children',
            'infants',
            'adult_count',
            'child_count',
            'infant_count',
            'departure_date',
            'departure_time',
            'tour_date',
            'tour_time'
        ];
        
        console.log('\n🔍 중요 컬럼 존재 여부 확인:');
        console.log('-' .repeat(50));
        
        importantColumns.forEach(colName => {
            const exists = columns.some(col => col.column_name === colName);
            const status = exists ? '✅ 존재' : '❌ 없음';
            console.log(`${colName.padEnd(20)} | ${status}`);
        });
        
        // 샘플 데이터 조회 (최근 5개)
        console.log('\n📊 샘플 데이터 (최근 5개):');
        console.log('-' .repeat(80));
        
        const sampleQuery = `
            SELECT 
                reservation_number,
                korean_name,
                product_name,
                usage_date,
                usage_time,
                people_adult,
                people_child,
                people_infant,
                payment_status,
                created_at
            FROM reservations 
            ORDER BY created_at DESC 
            LIMIT 5
        `;
        
        const sampleResult = await pool.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            sampleResult.rows.forEach((row, index) => {
                console.log(`\n${index + 1}. 예약번호: ${row.reservation_number}`);
                console.log(`   고객명: ${row.korean_name}`);
                console.log(`   상품명: ${row.product_name}`);
                console.log(`   이용일: ${row.usage_date}`);
                console.log(`   이용시간: ${row.usage_time}`);
                console.log(`   인원: 성인${row.people_adult} 아동${row.people_child} 유아${row.people_infant}`);
                console.log(`   상태: ${row.payment_status}`);
            });
        } else {
            console.log('샘플 데이터가 없습니다.');
        }
        
    } catch (error) {
        console.error('❌ 컬럼 확인 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    checkColumns()
        .then(() => {
            console.log('\n✅ 컬럼 확인 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 스크립트 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { checkColumns };
