// AI 수준 예약 데이터 파싱 함수 테스트
function parseReservationToJSON(text) {
    console.log('🤖 AI 수준 파싱 시작...');
    
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // 초기 데이터 구조
    let data = {
        reservation_number: null,
        channel: '웹',
        platform_name: null,
        product_name: null,
        korean_name: null,
        english_first_name: null,
        english_last_name: null,
        phone: null,
        email: null,
        kakao_id: null,
        usage_date: null,
        usage_time: null,
        guest_count: 1,
        people_adult: 1,
        people_child: 0,
        people_infant: 0,
        package_type: null,
        total_amount: null,
        adult_unit_price: null,
        child_unit_price: null,
        payment_status: '대기',
        code_issued: false,
        memo: null
    };
    
    // 플랫폼 감지
    const fullText = text.toLowerCase();
    if (fullText.includes('nol') || fullText.includes('인터파크')) {
        data.platform_name = 'NOL';
        console.log('🔍 감지된 플랫폼: NOL');
        console.log('🎯 NOL 인터파크 특화 파싱 모드 활성화');
    } else if (fullText.includes('klook')) {
        data.platform_name = 'KLOOK';
    } else if (fullText.includes('viator')) {
        data.platform_name = 'VIATOR';
    } else if (fullText.includes('getyourguide')) {
        data.platform_name = 'GETYOURGUIDE';
    } else if (fullText.includes('expedia')) {
        data.platform_name = 'EXPEDIA';
    } else {
        data.platform_name = 'NOL'; // 기본값
        console.log('🔍 감지된 플랫폼: NOL');
        console.log('🎯 NOL 인터파크 특화 파싱 모드 활성화');
    }
    
    // NOL 인터파크 특화 패턴
    if (data.platform_name === 'NOL') {
        // NOL 예약번호 패턴
        const nolReservationPattern = /NOL\d{8,}/i;
        const nolMatch = text.match(nolReservationPattern);
        if (nolMatch) {
            data.reservation_number = nolMatch[0];
            console.log(`✅ NOL 예약번호 발견: ${data.reservation_number}`);
        }
        
        // NOL 상품명 패턴
        const nolProductPatterns = [
            /상품명[\s:：]*(.+?)(?:\n|$)/,
            /괌\s*[^\n]*(?:투어|입장권|체험|워터|월드|돌핀|언더워터)[^\n]*/i
        ];
        
        for (const pattern of nolProductPatterns) {
            const match = text.match(pattern);
            if (match) {
                data.product_name = match[0].replace(/상품명[\s:：]*/, '').trim();
                console.log(`✅ NOL 상품명 발견: ${data.product_name}`);
                break;
            }
        }
        
        // NOL 이용일 패턴 (한글 날짜 형식)
        const nolDatePatterns = [
            /이용일[\s:：]*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
            /(\d{4})-(\d{1,2})-(\d{1,2})/
        ];
        
        for (const pattern of nolDatePatterns) {
            const match = text.match(pattern);
            if (match) {
                const year = match[1];
                const month = match[2].padStart(2, '0');
                const day = match[3].padStart(2, '0');
                data.usage_date = `${year}-${month}-${day}`;
                console.log(`✅ NOL 이용일 발견: ${data.usage_date}`);
                break;
            }
        }
        
        // NOL 원화 → 달러 환산
        const krwPattern = /([\d,]+)원/;
        const krwMatch = text.match(krwPattern);
        if (krwMatch) {
            const krwAmount = parseInt(krwMatch[1].replace(/,/g, ''));
            const usdAmount = Math.round(krwAmount / 1300); // 1300원 = 1달러 고정 환율
            data.total_amount = usdAmount;
            console.log(`💱 원화 → 달러 환산: ${krwMatch[0]} → $${usdAmount}`);
        }
        
        // NOL 인원수 패턴
        const nolPeoplePatterns = [
            /성인\s*(\d+)명/,
            /소아\s*(\d+)명/,
            /유아\s*(\d+)명/
        ];
        
        const adultMatch = text.match(nolPeoplePatterns[0]);
        if (adultMatch) {
            data.people_adult = parseInt(adultMatch[1]);
            data.guest_count = data.people_adult;
            console.log(`👥 NOL 인원수 발견: 성인 ${data.people_adult}명`);
        }
        
        const childMatch = text.match(nolPeoplePatterns[1]);
        if (childMatch) {
            data.people_child = parseInt(childMatch[1]);
            data.guest_count += data.people_child;
            console.log(`👥 NOL 인원수 발견: 소아 ${data.people_child}명`);
        }
        
        const infantMatch = text.match(nolPeoplePatterns[2]);
        if (infantMatch) {
            data.people_infant = parseInt(infantMatch[1]);
            console.log(`👥 NOL 인원수 발견: 유아 ${data.people_infant}명`);
        }
    }
    
    // 라인별 파싱
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const nextLine = i < lines.length - 1 ? lines[i + 1] : null;
        
        console.log(`📝 파싱 중: ${line}`);
        
        // 예약번호
        if (!data.reservation_number && (lowerLine.includes('booking') || lowerLine.includes('reservation') || 
            lowerLine.includes('예약번호') || lowerLine.includes('confirmation'))) {
            const reservationPatterns = [
                /(?:booking|reservation|예약번호|confirmation)[\s:：#]*([A-Z0-9]{6,})/i,
                /([A-Z]{2,3}\d{6,})/,
                /(\d{10,})/
            ];
            
            for (const pattern of reservationPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.reservation_number = match[1];
                    break;
                }
            }
        }
        
        // 상품명
        if (!data.product_name && (lowerLine.includes('product') || lowerLine.includes('상품') || 
            lowerLine.includes('tour') || lowerLine.includes('ticket'))) {
            const productPatterns = [
                /(?:product|상품명|tour|ticket)[\s:：]*(.+)/i,
                /(괌[^:\n]*(?:투어|입장권|체험|워터|월드|돌핀|언더워터)[^:\n]*)/i
            ];
            
            for (const pattern of productPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.product_name = match[1].trim();
                    break;
                }
            }
        }

        // 한글 이름 (개선된 패턴)
        if (!data.korean_name) {
            // 명시적 한글명 패턴 - 콜론 뒤의 이름 추출
            if (lowerLine.includes('한글') || lowerLine.includes('이름') || lowerLine.includes('성명')) {
                const namePatterns = [
                    /(?:한글명|이름|성명)[\s:：]+([가-힣]{2,})/,
                    /한글[\s:：]+([가-힣]{2,})/
                ];
                
                for (const pattern of namePatterns) {
                    const match = line.match(pattern);
                    if (match && match[1] !== '한글명' && match[1] !== '이름' && match[1] !== '성명') {
                        data.korean_name = match[1];
                        console.log(`✅ 한글 이름 발견: ${data.korean_name}`);
                        break;
                    }
                }
            }
            // 단독 한글 이름 패턴 (라인에 한글 이름만 있는 경우)
            else {
                const koreanNameMatch = line.match(/^([가-힣]{2,4})$/);
                if (koreanNameMatch) {
                    data.korean_name = koreanNameMatch[1];
                    console.log(`✅ 단독 한글 이름 발견: ${data.korean_name}`);
                }
            }
        }

        // 영문 이름
        if ((!data.english_first_name || !data.english_last_name) && 
            (lowerLine.includes('영문') || lowerLine.includes('english'))) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1) {
                const englishName = parts[1].trim();
                const nameParts = englishName.split(/\s+/);
                if (nameParts.length >= 2) {
                    data.english_first_name = nameParts[0];
                    data.english_last_name = nameParts.slice(1).join(' ');
                } else if (nameParts.length === 1) {
                    data.english_first_name = nameParts[0];
                    data.english_last_name = '';
                }
            }
        }
        
        // 이메일
        if (!data.email) {
            const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
                data.email = emailMatch[1];
            }
        }
        
        // 전화번호 (개선된 패턴)
        if (!data.phone) {
            // 명시적 전화번호 패턴
            if (lowerLine.includes('전화') || lowerLine.includes('phone') || lowerLine.includes('mobile')) {
                const phonePatterns = [
                    /(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})/,
                    /(010[-\s]?\d{4}[-\s]?\d{4})/,
                    /(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        break;
                    }
                }
            }
            // 단독 전화번호 패턴 (라인에 전화번호만 있는 경우)
            else {
                const phonePatterns = [
                    /^(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})$/,
                    /^(010[-\s]?\d{4}[-\s]?\d{4})$/,
                    /^(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})$/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        console.log(`✅ 단독 전화번호 발견: ${data.phone}`);
                        break;
                    }
                }
            }
        }

        // 카카오톡 아이디 (개선된 패턴)
        if (!data.kakao_id && lowerLine.includes('카카오톡 아이디')) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1 && parts[1].trim().length > 0) {
                data.kakao_id = parts[1].trim();
            } else if (nextLine && nextLine.trim().length > 0 && !nextLine.includes(':')) {
                data.kakao_id = nextLine.trim();
            }
        }
    }
    
    // 데이터 후처리 및 검증
    console.log('🔍 파싱된 데이터 검증 중...');
    
    // 필수 데이터 검증 및 기본값 설정
    if (!data.reservation_number) {
        console.log('⚠️ 예약번호가 없습니다. 임시 번호를 생성합니다.');
        data.reservation_number = 'TEMP_' + Date.now();
    }
    
    if (!data.korean_name) {
        console.log('⚠️ 한글 이름이 없습니다.');
    }
    
    if (!data.english_first_name && !data.english_last_name) {
        console.log('⚠️ 영문 이름이 불완전합니다.');
    }
    
    if (!data.product_name) {
        console.log('⚠️ 상품명이 없습니다.');
        data.product_name = '상품명 미확인';
    }
    
    if (!data.usage_date) {
        console.log('⚠️ 이용일이 없습니다.');
    }
    
    if (!data.total_amount) {
        console.log('⚠️ 총 금액이 없습니다.');
    }
    
    // 단가 계산
    if (data.total_amount && data.people_adult > 0) {
        data.adult_unit_price = Math.round(data.total_amount / data.people_adult);
    }
    
    console.log(`✅ 파싱 완료: {
  reservation_number: '${data.reservation_number}',
  korean_name: ${data.korean_name ? `'${data.korean_name}'` : 'null'},
  english_name: '${data.english_first_name || 'null'} ${data.english_last_name || 'null'}',
  product_name: '${data.product_name}',
  usage_date: ${data.usage_date ? `'${data.usage_date}'` : 'null'},
  people_adult: ${data.people_adult},
  total_amount: ${data.total_amount || 'null'}
}`);
    
    return data;
}

// 테스트 데이터
const testData1 = `NOL 인터파크 예약 확인서
예약번호: NOL20250115001
상품명: 괌 언더워터월드 입장권 + 돌핀 워칭 투어
이용일: 2025년 1월 20일
이용시간: 오전 10:00
예약자 정보:
한글명: 김철수
영문명: KIM CHULSOO
전화번호: 010-1234-5678
이메일: chulsoo@email.com
카카오톡 아이디: chulsoo123
인원수:
성인 2명
소아 1명
총 금액: 195,000원
결제상태: 결제완료`;

const testData2 = `Reservation Confirmation
Booking Number: ABC123456789
Product: Guam Underwater World & Dolphin Tour
Date: 2025-01-20
Time: 10:00 AM
Guest Information:
Korean Name: 이영희
English Name: LEE YOUNGHEE
Phone: +1-671-555-0123
Email: younghee@gmail.com
Guests: 2 Adults, 1 Child
Total Amount: $150.00
Payment Status: Confirmed`;

const testData3 = `상품명: 괌 돌핀 투어
이용일: 2025년 1월 25일
성인 1명`;

const testData4 = `김철수
010-1234-5678
괌 투어`;

// 테스트 실행
console.log('🧪 NOL 인터파크 파싱 테스트 시작...\n');

console.log('=== 테스트 1: NOL 인터파크 형식 ===');
try {
    const result1 = parseReservationToJSON(testData1);
    console.log('파싱 결과:', JSON.stringify(result1, null, 2));
} catch (error) {
    console.error('테스트 1 오류:', error.message);
}

console.log('\n=== 테스트 2: 일반 형식 ===');
try {
    const result2 = parseReservationToJSON(testData2);
    console.log('파싱 결과:', JSON.stringify(result2, null, 2));
} catch (error) {
    console.error('테스트 2 오류:', error.message);
}

console.log('\n=== 테스트 3: 부분 정보만 있는 경우 ===');
try {
    const result3 = parseReservationToJSON(testData3);
    console.log('파싱 결과:', JSON.stringify(result3, null, 2));
} catch (error) {
    console.error('테스트 3 오류:', error.message);
}

console.log('\n=== 테스트 4: 최소 정보만 있는 경우 ===');
try {
    const result4 = parseReservationToJSON(testData4);
    console.log('파싱 결과:', JSON.stringify(result4, null, 2));
} catch (error) {
    console.error('테스트 4 오류:', error.message);
}

console.log('\n✅ 모든 파싱 테스트 완료');
