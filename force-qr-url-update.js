const QRCode = require('qrcode');
const jsonDB = require('./utils/jsonDB');

async function forceUpdateQRCodesToURL() {
    console.log('🔄 QR코드 URL 강제 업데이트 시작...');
    console.log('📝 모든 사용자의 QR코드를 완전한 URL로 재생성합니다.');
    
    try {
        // 모든 사용자 조회
        const users = await jsonDB.findAll('users');
        console.log(`📊 총 ${users.length}명의 사용자 발견`);
        
        let updatedCount = 0;
        
        for (const user of users) {
            console.log(`🔧 사용자 ${user.customer_name} (${user.email || 'undefined'}) QR코드 업데이트 중...`);
            
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
                
                // 사용자 정보 업데이트 (강제)
                await jsonDB.update('users', user.id, {
                    qr_image_path: qrDataURL
                });
                
                updatedCount++;
                console.log(`✅ ${user.customer_name} QR코드 URL 업데이트 완료`);
                console.log(`   📱 QR코드 스캔 시 연결: ${cardUrl}`);
                
            } catch (error) {
                console.error(`❌ ${user.customer_name} QR코드 업데이트 실패:`, error.message);
            }
        }
        
        console.log(`🎉 강제 업데이트 완료! ${updatedCount}명의 사용자 QR코드가 URL로 업데이트되었습니다.`);
        console.log('📱 이제 제휴업체 직원이 QR코드를 스캔하면 사용처리 페이지로 연결됩니다.');
        
    } catch (error) {
        console.error('❌ 강제 업데이트 중 오류 발생:', error);
        process.exit(1);
    }
}

// 스크립트 실행
if (require.main === module) {
    forceUpdateQRCodesToURL()
        .then(() => {
            console.log('✅ QR코드 URL 강제 업데이트가 성공적으로 완료되었습니다.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 강제 업데이트 실패:', error);
            process.exit(1);
        });
}

module.exports = forceUpdateQRCodesToURL;
