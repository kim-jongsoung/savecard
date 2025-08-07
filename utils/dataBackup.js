const fs = require('fs');
const path = require('path');

// 데이터 백업 및 복원 시스템 (DB 대안)
class DataBackup {
    constructor() {
        this.backupDir = path.join(__dirname, '..', 'data');
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    // 데이터 저장 (타임스탬프 포함)
    saveData(filename, data) {
        try {
            const filePath = path.join(this.backupDir, filename);
            const backupData = {
                lastUpdated: new Date().toISOString(),
                data: data
            };
            fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
            console.log(`✅ 데이터 백업 완료: ${filename}`);
            return true;
        } catch (error) {
            console.error(`❌ 데이터 백업 실패: ${filename}`, error);
            return false;
        }
    }

    // 데이터 로드
    loadData(filename) {
        try {
            const filePath = path.join(this.backupDir, filename);
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const backupData = JSON.parse(fileContent);
                console.log(`✅ 데이터 로드 완료: ${filename} (${backupData.lastUpdated})`);
                return backupData.data;
            }
            return [];
        } catch (error) {
            console.error(`❌ 데이터 로드 실패: ${filename}`, error);
            return [];
        }
    }

    // 모든 데이터 백업
    backupAllData() {
        const stores = this.loadData('stores.json');
        const cards = this.loadData('cards.json');
        const usage = this.loadData('usage.json');
        const applications = this.loadData('partner-applications.json');

        console.log(`📊 백업 상태:`);
        console.log(`- 제휴업체: ${stores.length}개`);
        console.log(`- 카드: ${cards.length}개`);
        console.log(`- 사용내역: ${usage.length}개`);
        console.log(`- 신청서: ${applications.length}개`);

        return {
            stores,
            cards,
            usage,
            applications
        };
    }

    // 데이터 추가 (중복 방지)
    addData(filename, newItem, uniqueKey = 'id') {
        const existingData = this.loadData(filename);
        
        // 중복 확인
        const exists = existingData.find(item => 
            item[uniqueKey] === newItem[uniqueKey]
        );
        
        if (!exists) {
            existingData.push({
                ...newItem,
                createdAt: new Date().toISOString()
            });
            this.saveData(filename, existingData);
            return true;
        }
        
        console.log(`⚠️ 중복 데이터 감지: ${filename} - ${uniqueKey}: ${newItem[uniqueKey]}`);
        return false;
    }

    // 데이터 업데이트
    updateData(filename, updatedItem, uniqueKey = 'id') {
        const existingData = this.loadData(filename);
        const index = existingData.findIndex(item => 
            item[uniqueKey] === updatedItem[uniqueKey]
        );
        
        if (index !== -1) {
            existingData[index] = {
                ...existingData[index],
                ...updatedItem,
                updatedAt: new Date().toISOString()
            };
            this.saveData(filename, existingData);
            return true;
        }
        
        return false;
    }
}

module.exports = new DataBackup();
