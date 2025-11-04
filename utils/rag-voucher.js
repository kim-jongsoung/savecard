const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');

/**
 * RAG 기반 바우처 이용방법 생성기
 * - 데이터베이스에서 상품 가이드 조회
 * - AI를 통해 바우챠에 맞는 이용방법 생성
 */

const RAG_DIR = path.join(__dirname, '..', 'rag', 'products');

// DB 연결 풀
 let pool = null;
 function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
        });
    }
    return pool;
}

/**
 * 상품명으로 RAG 가이드 검색 (데이터베이스)
 */
async function findProductGuide(productName) {
    try {
        if (!productName) {
            console.log('⚠️ 상품명 없음 - RAG 검색 건너뛰기');
            return null;
        }
        
        console.log(`🔍 RAG DB 검색: "${productName}"`);
        
        const dbPool = getPool();
        
        // 1차 시도: 정확한 매칭
        let result = await dbPool.query(`
            SELECT id, product_name, content
            FROM product_guides
            WHERE LOWER(product_name) = LOWER($1)
            LIMIT 1
        `, [productName]);
        
        // 2차 시도: 부분 매칭 (앞뒤 공백 제거)
        if (result.rows.length === 0) {
            result = await dbPool.query(`
                SELECT id, product_name, content
                FROM product_guides
                WHERE LOWER(TRIM(product_name)) LIKE LOWER(TRIM($1))
                LIMIT 1
            `, [`%${productName}%`]);
        }
        
        // 3차 시도: 키워드 기반 매칭
        if (result.rows.length === 0) {
            result = await dbPool.query(`
                SELECT id, product_name, content
                FROM product_guides
                WHERE LOWER(product_name) LIKE LOWER($1)
                   OR LOWER($1) LIKE LOWER('%' || product_name || '%')
                   OR content ILIKE $1
                ORDER BY 
                    CASE 
                        WHEN LOWER(product_name) LIKE LOWER($1) THEN 1
                        WHEN LOWER($1) LIKE LOWER('%' || product_name || '%') THEN 2
                        ELSE 3
                    END
                LIMIT 1
            `, [`%${productName}%`]);
        }
        
        if (result.rows.length === 0) {
            console.log(`⚠️ 매칭되는 가이드 없음: "${productName}"`);
            
            // 디버깅: 등록된 가이드 목록 출력
            const allGuides = await dbPool.query(`SELECT product_name FROM product_guides LIMIT 10`);
            console.log('📋 등록된 가이드:', allGuides.rows.map(r => r.product_name));
            
            return null;
        }
        
        const guide = result.rows[0];
        console.log(`✅ 매칭 성공! "${productName}" → "${guide.product_name}"`);
        
        return {
            id: guide.id,
            name: guide.product_name,
            content: guide.content
        };
        
    } catch (error) {
        console.error('❌ RAG DB 검색 오류:', error);
        return null;
    }
}

/**
 * 가이드 내용에서 모든 섹션 추출 (자유 형식 지원)
 */
function extractAllSections(content) {
    try {
        const sections = [];
        
        // === 섹션명 === 패턴으로 모든 섹션 찾기
        const sectionPattern = /===\s*(.+?)\s*===\n([\s\S]+?)(?=\n===|$)/g;
        let match;
        
        while ((match = sectionPattern.exec(content)) !== null) {
            const sectionName = match[1].trim();
            const sectionContent = match[2].trim();
            
            sections.push({
                name: sectionName,
                content: sectionContent
            });
        }
        
        console.log(`📑 추출된 섹션 수: ${sections.length}`);
        sections.forEach(s => console.log(`   - ${s.name}`));
        
        return sections;
    } catch (error) {
        console.error('❌ 섹션 추출 오류:', error);
        return [];
    }
}

/**
 * 가이드 내용에서 이용방법 섹션만 추출 (하위 호환성)
 */
function extractUsageInstructions(content) {
    try {
        const sections = extractAllSections(content);
        const usageSection = sections.find(s => 
            s.name.includes('이용 방법') || 
            s.name.includes('이용방법') ||
            s.name.includes('How to Use')
        );
        
        return usageSection ? usageSection.content : null;
    } catch (error) {
        console.error('❌ 이용방법 추출 오류:', error);
        return null;
    }
}

/**
 * 텍스트를 HTML로 변환 (마크다운 스타일)
 */
function convertToHTML(text) {
    if (!text) return '';
    
    // 줄 단위로 처리
    const lines = text.split('\n');
    const htmlLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 빈 줄
        if (!line.trim()) {
            htmlLines.push('<br>');
            continue;
        }
        
        // 숫자 리스트 (1. 2. 3.)
        const numberMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (numberMatch) {
            htmlLines.push(`<div style="margin-top: 12px; margin-bottom: 8px;"><strong>${numberMatch[1]}. ${numberMatch[2]}</strong></div>`);
            continue;
        }
        
        // 하위 항목 (- 또는 공백 + -)
        const bulletMatch = line.match(/^\s*-\s+(.+)$/);
        if (bulletMatch) {
            htmlLines.push(`<div style="margin-left: 20px; margin-bottom: 5px; color: #555;">• ${bulletMatch[1]}</div>`);
            continue;
        }
        
        // 일반 텍스트
        htmlLines.push(`<div style="margin-bottom: 5px;">${line}</div>`);
    }
    
    return `<div style="line-height: 1.8; font-size: 14px;">${htmlLines.join('')}</div>`;
}

/**
 * 섹션 배열을 HTML로 변환 (여러 섹션 지원)
 */
function convertSectionsToHTML(sections) {
    if (!sections || sections.length === 0) return '';
    
    const htmlSections = sections.map(section => {
        const contentHTML = convertToHTML(section.content);
        return `
            <div style="margin-bottom: 24px;">
                <h4 style="color: #1a237e; font-size: 16px; font-weight: 700; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e0e0e0;">
                    ${section.name}
                </h4>
                ${contentHTML}
            </div>
        `;
    });
    
    return htmlSections.join('');
}

/**
 * AI 기반 맞춤형 이용방법 생성 (OpenAI 사용)
 */
async function generateWithAI(productName, guideContent, reservationData) {
    // OpenAI API를 사용하여 상황에 맞는 이용방법 생성
    // 여기서는 기본 템플릿 반환 (실제 구현 시 OpenAI API 호출)
    
    const prompt = `
다음 정보를 바탕으로 고객에게 제공할 바우처 이용방법을 HTML 형식으로 생성해주세요.

상품명: ${productName}
이용일: ${reservationData.usage_date}
인원: 성인 ${reservationData.people_adult}명, 아동 ${reservationData.people_child || 0}명

참고 가이드:
${guideContent}

요구사항:
- 간결하고 명확하게 (모바일 화면 고려)
- 핵심 정보만 포함 (주소, 시간, 입장 절차)
- 숫자 리스트 형식 사용
- 한국어로 작성
`;

    // TODO: OpenAI API 호출
    // const response = await openai.chat.completions.create({...});
    
    // 임시로 기본 변환 반환
    return convertToHTML(guideContent);
}

/**
 * 메인 함수: 바우처 이용방법 생성
 */
async function generateVoucherInstructions(productName, reservationData) {
    try {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎯 RAG 바우처 생성 시작');
        console.log(`📦 상품명: "${productName}"`);
        
        if (!productName) {
            console.log('⚠️ 상품명 없음 - RAG 건너뛰기');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            return null;
        }
        
        // 1. RAG에서 상품 가이드 찾기
        console.log('📂 1단계: DB에서 가이드 검색 중...');
        const guide = await findProductGuide(productName);
        
        if (!guide) {
            console.log('❌ RAG 가이드 없음 - 이용방법 섹션 생략');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            return null;
        }
        
        console.log(`✅ 가이드 발견: "${guide.name}"`);
        console.log(`📄 가이드 길이: ${guide.content.length}자`);
        
        // 2. 모든 섹션 추출 (자유 형식 지원)
        console.log('📝 2단계: 모든 섹션 추출 중...');
        const sections = extractAllSections(guide.content);
        
        if (!sections || sections.length === 0) {
            console.log('❌ 섹션을 찾을 수 없음');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            return null;
        }
        
        console.log(`✅ 섹션 추출 성공: ${sections.length}개`);
        
        // 3. HTML 변환
        console.log('🎨 3단계: HTML 변환 중...');
        const htmlInstructions = convertSectionsToHTML(sections);
        
        console.log(`✅ HTML 변환 완료: ${htmlInstructions.length}자`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        return htmlInstructions;
        
    } catch (error) {
        console.error('❌ 바우처 이용방법 생성 오류:', error);
        console.error('스택:', error.stack);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return null;
    }
}

/**
 * 기본 이용방법 템플릿
 */
function getDefaultInstructions() {
    return `
<div style="line-height: 1.6;">
    <div style="margin-bottom: 10px;"><strong>1. 예약 확인</strong></div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 바우처를 출력하거나 모바일로 지참해주세요</div>
    
    <div style="margin-bottom: 10px;"><strong>2. 현장 도착</strong></div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 예약 시간 10분 전 도착 권장</div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 주차 가능 여부 사전 확인</div>
    
    <div style="margin-bottom: 10px;"><strong>3. 입장 절차</strong></div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 매표소/접수처에서 바우처 제시</div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 신분증 지참 (본인 확인용)</div>
    
    <div style="margin-bottom: 10px;"><strong>4. 이용 안내</strong></div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 현장 스태프의 안내를 따라주세요</div>
    <div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• 안전 수칙 준수 필수</div>
</div>
`;
}

/**
 * 상품 가이드 등록 (관리자용) - 데이터베이스
 */
async function registerProductGuide(productName, guideContent, createdBy = 'admin') {
    try {
        const dbPool = getPool();
        
        // 카테고리 추출
        const categoryMatch = guideContent.match(/카테고리:\s*(.+)/);
        const category = categoryMatch ? categoryMatch[1].trim() : '미분류';
        
        const result = await dbPool.query(`
            INSERT INTO product_guides (product_name, category, content, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, product_name
        `, [productName, category, guideContent, createdBy]);
        
        console.log(`✅ 상품 가이드 DB 등록 완료: ${productName}`);
        return { success: true, guide: result.rows[0] };
        
    } catch (error) {
        console.error('❌ 상품 가이드 DB 등록 오류:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 등록된 상품 목록 조회 (데이터베이스)
 */
async function listProductGuides() {
    try {
        const dbPool = getPool();
        
        const result = await dbPool.query(`
            SELECT id, product_name, category, content, created_at, updated_at
            FROM product_guides
            ORDER BY created_at DESC
        `);
        
        return result.rows.map(row => ({
            id: row.id,
            name: row.product_name,
            category: row.category || '미분류',
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
        
    } catch (error) {
        console.error('❌ 상품 목록 DB 조회 오류:', error);
        return [];
    }
}

module.exports = {
    generateVoucherInstructions,
    registerProductGuide,
    listProductGuides,
    findProductGuide,
    convertToHTML,
    extractAllSections,
    convertSectionsToHTML
};
