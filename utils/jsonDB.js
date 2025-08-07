const fs = require('fs-extra');
const path = require('path');

class JsonDB {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        this.ensureDataDir();
    }

    ensureDataDir() {
        fs.ensureDirSync(this.dataDir);
    }

    getFilePath(tableName) {
        return path.join(this.dataDir, `${tableName}.json`);
    }

    async read(tableName) {
        try {
            const filePath = this.getFilePath(tableName);
            const exists = await fs.pathExists(filePath);
            if (!exists) {
                await fs.writeJson(filePath, []);
                return [];
            }
            return await fs.readJson(filePath);
        } catch (error) {
            console.error(`Error reading ${tableName}:`, error);
            return [];
        }
    }

    async write(tableName, data) {
        try {
            const filePath = this.getFilePath(tableName);
            await fs.writeJson(filePath, data, { spaces: 2 });
            return true;
        } catch (error) {
            console.error(`Error writing ${tableName}:`, error);
            return false;
        }
    }

    async insert(tableName, data) {
        try {
            const records = await this.read(tableName);
            const newId = records.length > 0 ? Math.max(...records.map(r => r.id || 0)) + 1 : 1;
            const newRecord = {
                id: newId,
                ...data,
                created_at: new Date().toISOString()
            };
            records.push(newRecord);
            await this.write(tableName, records);
            return newRecord;
        } catch (error) {
            console.error(`Error inserting into ${tableName}:`, error);
            return null;
        }
    }

    async findById(tableName, id) {
        try {
            const records = await this.read(tableName);
            return records.find(r => r.id === parseInt(id));
        } catch (error) {
            console.error(`Error finding by ID in ${tableName}:`, error);
            return null;
        }
    }

    async findOne(tableName, condition) {
        try {
            const records = await this.read(tableName);
            return records.find(record => {
                return Object.keys(condition).every(key => record[key] === condition[key]);
            });
        } catch (error) {
            console.error(`Error finding one in ${tableName}:`, error);
            return null;
        }
    }

    async findAll(tableName, condition = {}) {
        try {
            const records = await this.read(tableName);
            if (Object.keys(condition).length === 0) {
                return records;
            }
            return records.filter(record => {
                return Object.keys(condition).every(key => record[key] === condition[key]);
            });
        } catch (error) {
            console.error(`Error finding all in ${tableName}:`, error);
            return [];
        }
    }

    async update(tableName, id, data) {
        try {
            const records = await this.read(tableName);
            const index = records.findIndex(r => r.id === parseInt(id));
            if (index === -1) return null;
            
            records[index] = {
                ...records[index],
                ...data,
                updated_at: new Date().toISOString()
            };
            await this.write(tableName, records);
            return records[index];
        } catch (error) {
            console.error(`Error updating ${tableName}:`, error);
            return null;
        }
    }

    async delete(tableName, id) {
        try {
            const records = await this.read(tableName);
            const filteredRecords = records.filter(r => r.id !== parseInt(id));
            await this.write(tableName, filteredRecords);
            return true;
        } catch (error) {
            console.error(`Error deleting from ${tableName}:`, error);
            return false;
        }
    }

    // 특별한 쿼리들
    async getStats() {
        try {
            console.log('=== getStats 함수 시작 ===');
            const agencies = await this.read('agencies');
            console.log('agencies 개수:', agencies.length);
            
            const users = await this.read('users');
            console.log('users 개수:', users.length);
            
            const usages = await this.read('usages');
            console.log('usages 개수:', usages.length);
            
            const stores = await this.read('stores');
            console.log('stores 개수:', stores.length);
            console.log('stores 데이터 샘플:', stores.slice(0, 2));
            
            const banners = await this.findAll('banners', { is_active: true });
            console.log('active banners 개수:', banners.length);

            const stats = {
                total_agencies: agencies.length,
                total_users: users.length,
                total_usages: usages.length,
                total_stores: stores.length,
                active_banners: banners.length
            };
            
            console.log('최종 stats 객체:', stats);
            return stats;
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                total_agencies: 0,
                total_users: 0,
                total_usages: 0,
                total_stores: 0,
                active_banners: 0
            };
        }
    }

    async getRecentUsages(limit = 10) {
        try {
            const usages = await this.read('usages');
            const users = await this.read('users');
            const agencies = await this.read('agencies');

            const recentUsages = usages
                .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
                .slice(0, limit);

            return recentUsages.map(usage => {
                const user = users.find(u => u.token === usage.token);
                const agency = user ? agencies.find(a => a.id === user.agency_id) : null;
                
                return {
                    ...usage,
                    customer_name: user ? user.customer_name : 'Unknown',
                    agency_name: agency ? agency.name : 'Unknown'
                };
            });
        } catch (error) {
            console.error('Error getting recent usages:', error);
            return [];
        }
    }

    async getUsersWithAgency() {
        try {
            const users = await this.read('users');
            const agencies = await this.read('agencies');
            const usages = await this.read('usages');

            return users.map(user => {
                const agency = agencies.find(a => a.id === user.agency_id);
                const userUsages = usages.filter(u => u.token === user.token);
                
                return {
                    ...user,
                    agency_name: agency ? agency.name : 'Unknown',
                    usage_count: userUsages.length
                };
            });
        } catch (error) {
            console.error('Error getting users with agency:', error);
            return [];
        }
    }

    async getUsagesWithDetails() {
        try {
            const usages = await this.read('usages');
            const users = await this.read('users');
            const agencies = await this.read('agencies');

            return usages.map(usage => {
                const user = users.find(u => u.token === usage.token);
                const agency = user ? agencies.find(a => a.id === user.agency_id) : null;
                
                return {
                    ...usage,
                    customer_name: user ? user.customer_name : 'Unknown',
                    agency_name: agency ? agency.name : 'Unknown'
                };
            }).sort((a, b) => new Date(b.used_at) - new Date(a.used_at));
        } catch (error) {
            console.error('Error getting usages with details:', error);
            return [];
        }
    }
}

module.exports = new JsonDB();
