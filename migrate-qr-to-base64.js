const QRCode = require('qrcode');
const jsonDB = require('./utils/jsonDB');

async function migrateQRCodesToBase64() {
    console.log('🔄 QR코드 Base64 마이그레이션 시작...');
    
    try {
        // 모든 사용자 조회
        const users = await jsonDB.findAll('users');
        console.log(`📊 총 ${users.length}명의 사용자 발견`);
        
        let updatedCount = 0;
        
        for (const user of users) {
            // 파일 경로로 저장된 QR코드만 업데이트
            if (user.qr_image_path && user.qr_image_path.startsWith('/qrcodes/')) {
                console.log(`🔧 사용자 ${user.customer_name} (${user.email}) QR코드 업데이트 중...`);
                
                try {
                    // 제휴업체 직원이 스캔 시 사용처리 페이지로 연결되도록 완전한 URL로 QR코드 생성
                    const cardUrl = `https://savecard-production.up.railway.app/card?token=${user.token}`;
                    const qrDataURL = await QRCode.toDataURL(cardUrl, {
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        },
                        width: 256
                    });
                    
                    // 사용자 정보 업데이트
                    await jsonDB.update('users', user.id, {
                        qr_image_path: qrDataURL
                    });
                    
                    updatedCount++;
                    console.log(`✅ ${user.customer_name} QR코드 업데이트 완료`);
                    
                } catch (error) {
                    console.error(`❌ ${user.customer_name} QR코드 업데이트 실패:`, error.message);
                }
            } else if (user.qr_image_path && user.qr_image_path.startsWith('data:image/png;base64,')) {
                console.log(`⏭️  ${user.customer_name} - 이미 Base64로 저장됨`);
            } else {
                console.log(`⚠️  ${user.customer_name} - QR코드 경로가 비어있음`);
            }
        }
        
        console.log(`🎉 마이그레이션 완료! ${updatedCount}명의 사용자 QR코드가 업데이트되었습니다.`);
        
    } catch (error) {
        console.error('❌ 마이그레이션 중 오류 발생:', error);
        process.exit(1);
    }
}

// 스크립트 실행
if (require.main === module) {
    migrateQRCodesToBase64()
        .then(() => {
            console.log('✅ 마이그레이션이 성공적으로 완료되었습니다.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 마이그레이션 실패:', error);
            process.exit(1);
        });
}

module.exports = migrateQRCodesToBase64;
