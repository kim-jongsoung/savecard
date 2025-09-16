// NOL 인터파크 예약 데이터 파싱 테스트 (독립 실행)

// AI 수준의 고급 로컬 파싱 함수 (복사)
function parseReservationToJSON(text) {
    console.log('🤖 AI 수준 파싱 시작...');
    
    // 더 지능적인 파싱을 위한 정규식 및 패턴 매칭
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = text.toLowerCase();
    
    // 기본 데이터 구조 (단일 테이블 구조에 맞게)
    const data = {
        reservation_number: null,
        channel: '웹',
        platform_name: 'NOL',
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
    
    // 플랫폼 자동 감지 (NOL 인터파크 특화)
    if (fullText.includes('nol') || fullText.includes('인터파크') || fullText.includes('interpark')) {
        data.platform_name = 'NOL';
    } else if (fullText.includes('klook')) {
        data.platform_name = 'KLOOK';
    } else if (fullText.includes('viator')) {
        data.platform_name = 'VIATOR';
    } else if (fullText.includes('getyourguide')) {
        data.platform_name = 'GETYOURGUIDE';
    } else if (fullText.includes('expedia')) {
        data.platform_name = 'EXPEDIA';
    }
    
    console.log(`🔍 감지된 플랫폼: ${data.platform_name}`);
    
    // NOL 인터파크 특화 패턴 매칭
    if (data.platform_name === 'NOL') {
        console.log('🎯 NOL 인터파크 특화 파싱 모드 활성화');
        
        // NOL 특화 예약번호 패턴
        const nolReservationPatterns = [
            /예약번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /주문번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /확인번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /NOL[\s\-]?(\d{8,})/i,
            /([A-Z]{2}\d{8,})/
        ];
        
        for (const pattern of nolReservationPatterns) {
            const match = text.match(pattern);
            if (match && !data.reservation_number) {
                data.reservation_number = match[1];
                console.log(`✅ NOL 예약번호 발견: ${data.reservation_number}`);
                break;
            }
        }
        
        // NOL 특화 상품명 패턴
        const nolProductPatterns = [
            /상품명[\s:：]*(.+?)(?:\n|$)/i,
            /투어명[\s:：]*(.+?)(?:\n|$)/i,
            /\[NOL\]\s*(.+?)(?:\n|$)/i,
            /괌\s*(.+?투어)/i,
            /(.+?(?:투어|체험|입장권|티켓))/i
        ];
        
        for (const pattern of nolProductPatterns) {
            const match = text.match(pattern);
            if (match && !data.product_name) {
                data.product_name = match[1].trim();
                console.log(`✅ NOL 상품명 발견: ${data.product_name}`);
                break;
            }
        }
        
        // NOL 특화 날짜 패턴 (한국 형식)
        const nolDatePatterns = [
            /이용일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /방문일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /체크인[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /(\d{4})\-(\d{1,2})\-(\d{1,2})/,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/
        ];
        
        for (const pattern of nolDatePatterns) {
            const match = text.match(pattern);
            if (match && !data.usage_date) {
                let year, month, day;
                if (pattern.toString().includes('년')) {
                    [, year, month, day] = match;
                } else if (pattern.toString().includes('\\d{4}')) {
                    [, year, month, day] = match;
                } else {
                    [, month, day, year] = match;
                }
                
                if (year && month && day) {
                    data.usage_date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    console.log(`✅ NOL 이용일 발견: ${data.usage_date}`);
                }
                break;
            }
        }
        
        // NOL 특화 금액 패턴 (원화 → 달러 환산)
        const nolPricePatterns = [
            /총\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /결제\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /(\d{1,3}(?:,\d{3})*)\s*원/,
            /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
            /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*달러/
        ];
        
        for (const pattern of nolPricePatterns) {
            const match = text.match(pattern);
            if (match && !data.total_amount) {
                let price = parseFloat(match[1].replace(/,/g, ''));
                // 원화인 경우 달러로 환산 (1300원 = 1달러 기준)
                if (match[0].includes('원')) {
                    price = Math.round(price / 1300 * 100) / 100;
                    console.log(`💱 원화 → 달러 환산: ${match[1]}원 → $${price}`);
                }
                data.total_amount = price;
                break;
            }
        }
        
        // NOL 특화 인원수 패턴
        const nolPeoplePatterns = [
            /성인\s*(\d+)\s*명/i,
            /어른\s*(\d+)\s*명/i,
            /대인\s*(\d+)\s*명/i,
            /소아\s*(\d+)\s*명/i,
            /어린이\s*(\d+)\s*명/i,
            /유아\s*(\d+)\s*명/i,
            /총\s*(\d+)\s*명/i
        ];
        
        for (const pattern of nolPeoplePatterns) {
            const match = text.match(pattern);
            if (match) {
                const count = parseInt(match[1]);
                if (pattern.toString().includes('성인|어른|대인')) {
                    data.people_adult = count;
                } else if (pattern.toString().includes('소아|어린이')) {
                    data.people_child = count;
                } else if (pattern.toString().includes('유아')) {
                    data.people_infant = count;
                } else if (pattern.toString().includes('총') && !data.people_adult) {
                    data.people_adult = count;
                }
                console.log(`👥 NOL 인원수 발견: ${match[0]}`);
            }
        }
    }
    
    // 라인별 파싱 (일반 패턴)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
        
        console.log(`📝 파싱 중: ${line}`);
        
        // 한글 이름
        if (!data.korean_name && (lowerLine.includes('한글') || lowerLine.includes('이름') || 
            lowerLine.includes('성명')) && !lowerLine.includes('영문')) {
            const nameMatch = line.match(/([가-힣]{2,})/);
            if (nameMatch) {
                data.korean_name = nameMatch[1];
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
        
        // 전화번호
        if (!data.phone && (lowerLine.includes('전화') || lowerLine.includes('phone') || 
            lowerLine.includes('mobile'))) {
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
        
        // 카카오톡 아이디
        if (!data.kakao_id && lowerLine.includes('카카오톡 아이디')) {
            const kakaoMatch = nextLine || line.split(/[:：]/)[1];
            if (kakaoMatch && kakaoMatch.trim().length > 0) {
                data.kakao_id = kakaoMatch.trim();
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
    
    if (!data.english_first_name || !data.english_last_name) {
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
    
    // 전화번호 정리
    if (data.phone) {
        data.phone = data.phone.replace(/[^\d\+\-]/g, '');
    }
    
    // 단가 계산 (총 금액을 성인 수로 나눔)
    if (data.total_amount && data.people_adult > 0) {
        data.adult_unit_price = Math.round(data.total_amount / data.people_adult);
    }
    
    console.log('✅ 파싱 완료:', {
        reservation_number: data.reservation_number,
        korean_name: data.korean_name,
        english_name: `${data.english_first_name} ${data.english_last_name}`,
        product_name: data.product_name,
        usage_date: data.usage_date,
        people_adult: data.people_adult,
        total_amount: data.total_amount
    });
    
    return data;
}

// 테스트 데이터 1: NOL 인터파크 형식
const testData1 = `
NOL 인터파크 예약 확인서

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
결제상태: 결제완료
`;

// 테스트 데이터 2: 일반 형식
const testData2 = `
Reservation Confirmation

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
Payment Status: Confirmed
`;

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

console.log('\n✅ 파싱 테스트 완료');
