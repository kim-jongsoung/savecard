// 바우처 토큰 확인 스크립트
const token = 'VCH1759851906645tmykidjpd';

console.log('🔍 바우처 토큰 확인:', token);

// 로컬 SQLite 데이터베이스 확인
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'guamsavecard.db');
const db = new sqlite3.Database(dbPath);

console.log('📂 SQLite 데이터베이스 경로:', dbPath);

// assignments 테이블에서 바우처 토큰 검색
db.all(`
    SELECT 
        a.*,
        r.korean_name,
        r.product_name,
        r.usage_date
    FROM assignments a
    LEFT JOIN reservations r ON a.reservation_id = r.id
    WHERE a.voucher_token = ?
`, [token], (err, rows) => {
    if (err) {
        console.error('❌ 쿼리 오류:', err);
        return;
    }

    if (rows.length === 0) {
        console.log('❌ 해당 바우처 토큰을 찾을 수 없습니다.');
        
        // 모든 바우처 토큰 조회
        db.all(`
            SELECT voucher_token, reservation_id, created_at
            FROM assignments 
            WHERE voucher_token IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 10
        `, (err, allVouchers) => {
            if (err) {
                console.error('❌ 전체 바우처 조회 오류:', err);
                return;
            }
            
            console.log('\n📋 최근 생성된 바우처 토큰들:');
            allVouchers.forEach((voucher, index) => {
                console.log(`  ${index + 1}. ${voucher.voucher_token} (예약 ID: ${voucher.reservation_id})`);
            });
            
            db.close();
        });
    } else {
        console.log('✅ 바우처 토큰 발견!');
        console.log('📋 바우처 정보:');
        rows.forEach(row => {
            console.log(`  - 예약 ID: ${row.reservation_id}`);
            console.log(`  - 예약자명: ${row.korean_name}`);
            console.log(`  - 상품명: ${row.product_name}`);
            console.log(`  - 이용일자: ${row.usage_date}`);
            console.log(`  - 바우처 토큰: ${row.voucher_token}`);
            console.log(`  - 생성일시: ${row.created_at}`);
        });
        
        db.close();
    }
});
