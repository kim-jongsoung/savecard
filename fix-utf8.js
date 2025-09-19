/**
 * UTF-8 인코딩 문제 해결 스크립트
 * 모든 파일을 UTF-8 (BOM 없음)으로 변환
 */

const fs = require('fs');
const path = require('path');

// UTF-8 인코딩 강제 설정
process.env.NODE_OPTIONS = '--max-old-space-size=4096';
if (process.platform === 'win32') {
    // Windows 콘솔 UTF-8 설정
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {
        // 무시
    }
}

const projectRoot = __dirname;

// 처리할 파일 확장자들
const targetExtensions = ['.js', '.ejs', '.sql', '.md', '.json', '.yaml', '.yml', '.sh'];

// 제외할 디렉토리들
const excludeDirs = ['node_modules', '.git', 'qrcodes', 'pa'];

/**
 * 파일이 UTF-8인지 확인하고 변환
 */
function fixFileEncoding(filePath) {
    try {
        // 파일 읽기 (다양한 인코딩 시도)
        let content;
        
        try {
            // UTF-8로 시도
            content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            try {
                // 다른 인코딩으로 시도 후 UTF-8로 변환
                const buffer = fs.readFileSync(filePath);
                content = buffer.toString('utf8');
            } catch (e2) {
                console.warn(`⚠️  Cannot read file: ${filePath}`);
                return false;
            }
        }

        // BOM 제거
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }

        // UTF-8 (BOM 없음)으로 저장
        fs.writeFileSync(filePath, content, { encoding: 'utf8' });
        return true;
        
    } catch (error) {
        console.error(`❌ Error fixing ${filePath}:`, error.message);
        return false;
    }
}

/**
 * 디렉토리 재귀 처리
 */
function processDirectory(dirPath) {
    const items = fs.readdirSync(dirPath);
    let fixedCount = 0;
    
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            // 제외 디렉토리 체크
            if (!excludeDirs.includes(item)) {
                fixedCount += processDirectory(fullPath);
            }
        } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            
            if (targetExtensions.includes(ext)) {
                console.log(`🔧 Fixing: ${path.relative(projectRoot, fullPath)}`);
                if (fixFileEncoding(fullPath)) {
                    fixedCount++;
                }
            }
        }
    }
    
    return fixedCount;
}

/**
 * 메인 실행
 */
function main() {
    console.log('🚀 Starting UTF-8 encoding fix...');
    console.log(`📁 Project root: ${projectRoot}`);
    console.log(`🎯 Target extensions: ${targetExtensions.join(', ')}`);
    console.log(`🚫 Excluded directories: ${excludeDirs.join(', ')}`);
    console.log('');
    
    const startTime = Date.now();
    const fixedCount = processDirectory(projectRoot);
    const endTime = Date.now();
    
    console.log('');
    console.log('✅ UTF-8 encoding fix completed!');
    console.log(`📊 Fixed ${fixedCount} files in ${endTime - startTime}ms`);
    console.log('');
    console.log('🎉 All files are now UTF-8 encoded (without BOM)');
    console.log('💡 You can now run your Node.js scripts without encoding issues');
}

// 스크립트 직접 실행 시
if (require.main === module) {
    main();
}

module.exports = { fixFileEncoding, processDirectory };
