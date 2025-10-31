const fs = require('fs').promises;
const path = require('path');

/**
 * RAG 기반 바우처 이용방법 생성기
 * - 상품별 TXT 파일에서 정보 추출
 * - AI를 통해 바우처에 맞는 이용방법 생성
 */

const RAG_DIR = path.join(__dirname, '..', 'rag', 'products');

/**
 * 상품명으로 RAG 파일 검색
 */
async function findProductGuide(productName) {
    try {
        // RAG 디렉토리 존재 확인 및 생성
        try {
            await fs.access(RAG_DIR);
        } catch {
            console.log('📁 RAG 디렉토리 생성:', RAG_DIR);
            await fs.mkdir(RAG_DIR, { recursive: true });
        }
        
        // RAG 디렉토리의 모든 파일 읽기
        const files = await fs.readdir(RAG_DIR);
        const txtFiles = files.filter(f => f.endsWith('.txt'));
        
        if (txtFiles.length === 0) {
            console.log('⚠️ RAG 파일 없음 - 기본 템플릿 사용');
            return null;
        }
        
        console.log(`🔍 RAG 파일 검색: ${productName}`);
        
        // 각 파일에서 상품명 매칭
        for (const file of txtFiles) {
            const filePath = path.join(RAG_DIR, file);
            const content = await fs.readFile(filePath, 'utf-8');
            
            // 파일에서 상품명 추출
            const match = content.match(/상품명:\s*(.+)/);
            if (match) {
                const registeredName = match[1].trim();
                
                // 유사도 검사 (간단한 포함 여부)
                if (productName && (productName.includes(registeredName) || registeredName.includes(productName))) {
                    console.log(`✅ 매칭된 가이드: ${file}`);
                    return { file, content };
                }
            }
        }
        
        console.log('⚠️ 매칭되는 가이드 없음 - 기본 템플릿 사용');
        return null;
        
    } catch (error) {
        console.error('❌ RAG 파일 검색 오류:', error);
        return null;
    }
}

/**
 * 가이드 내용에서 이용방법 섹션 추출
 */
function extractUsageInstructions(content) {
    try {
        // "=== 이용 방법 ===" 섹션 추출
        const usageMatch = content.match(/=== 이용 방법 ===\n([\s\S]+?)(?:\n=== |$)/);
        if (usageMatch) {
            return usageMatch[1].trim();
        }
        
        return null;
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
    
    let html = text
        // 번호 리스트 (1. 2. 3.)
        .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="margin-bottom: 10px;"><strong>$1. $2</strong></div>')
        // 하위 항목 (- 로 시작)
        .replace(/^\s+-\s+(.+)$/gm, '<div style="margin-left: 15px; margin-bottom: 5px; font-size: 12px;">• $1</div>')
        // 줄바꿈
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
    
    return `<div style="line-height: 1.6;">${html}</div>`;
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
        if (!productName) {
            console.log('⚠️ 상품명 없음 - RAG 건너뛰기');
            return null;
        }
        
        // 1. RAG에서 상품 가이드 찾기
        const guide = await findProductGuide(productName);
        
        if (!guide) {
            console.log('⚠️ RAG 가이드 없음 - 이용방법 섹션 생략');
            return null;
        }
        
        // 2. 이용방법 섹션 추출
        const usageText = extractUsageInstructions(guide.content);
        
        if (!usageText) {
            console.log('⚠️ 이용방법 섹션 없음 - 섹션 생략');
            return null;
        }
        
        // 3. AI 기반 맞춤 생성 (또는 HTML 변환)
        const htmlInstructions = await generateWithAI(productName, usageText, reservationData);
        
        return htmlInstructions;
        
    } catch (error) {
        console.error('❌ 바우처 이용방법 생성 오류:', error);
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
 * 상품 가이드 등록 (관리자용)
 */
async function registerProductGuide(productName, guideContent) {
    try {
        // 파일명 생성 (상품명을 안전한 파일명으로 변환)
        const safeFileName = productName
            .replace(/[^a-zA-Z0-9가-힣\s]/g, '')
            .replace(/\s+/g, '-')
            .toLowerCase();
        
        const filePath = path.join(RAG_DIR, `${safeFileName}.txt`);
        
        // 파일 저장
        await fs.writeFile(filePath, guideContent, 'utf-8');
        
        console.log(`✅ 상품 가이드 등록 완료: ${filePath}`);
        return { success: true, file: filePath };
        
    } catch (error) {
        console.error('❌ 상품 가이드 등록 오류:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 등록된 상품 목록 조회
 */
async function listProductGuides() {
    try {
        const files = await fs.readdir(RAG_DIR);
        const txtFiles = files.filter(f => f.endsWith('.txt'));
        
        const products = [];
        for (const file of txtFiles) {
            const filePath = path.join(RAG_DIR, file);
            const content = await fs.readFile(filePath, 'utf-8');
            
            const nameMatch = content.match(/상품명:\s*(.+)/);
            const categoryMatch = content.match(/카테고리:\s*(.+)/);
            
            if (nameMatch) {
                products.push({
                    file,
                    name: nameMatch[1].trim(),
                    category: categoryMatch ? categoryMatch[1].trim() : '미분류',
                    path: filePath
                });
            }
        }
        
        return products;
        
    } catch (error) {
        console.error('❌ 상품 목록 조회 오류:', error);
        return [];
    }
}

module.exports = {
    generateVoucherInstructions,
    registerProductGuide,
    listProductGuides,
    findProductGuide,
    convertToHTML
};
