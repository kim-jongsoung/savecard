/**
 * Notification Service
 * Email and KakaoTalk notification adapter
 */

const nodemailer = require('nodemailer');

class NotifyService {
    constructor() {
        this.emailTransporter = null;
        this.kakaoAdapter = null;
        this.initializeEmail();
    }

    /**
     * Initialize email transporter
     */
    initializeEmail() {
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            this.emailTransporter = nodemailer.createTransporter({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            console.log('✅ Email transporter initialized');
        } else {
            console.log('⚠️ Email configuration not found - email notifications disabled');
        }
    }

    /**
     * Initialize KakaoTalk adapter
     * @param {Object} config - KakaoTalk API configuration
     */
    initializeKakao(config) {
        // Placeholder for KakaoTalk adapter initialization
        // This would integrate with actual KakaoTalk API service
        this.kakaoAdapter = {
            apiKey: config.apiKey,
            endpoint: config.endpoint,
            template: config.template
        };
        console.log('✅ KakaoTalk adapter initialized');
    }

    /**
     * Send reservation confirmation notification
     * @param {Object} reservation - Reservation data
     * @param {Object} options - Notification options
     */
    async sendConfirmationNotification(reservation, options = {}) {
        const notifications = [];

        try {
            // Email notification
            if (this.emailTransporter && reservation.email) {
                const emailResult = await this.sendConfirmationEmail(reservation, options);
                notifications.push({ type: 'email', status: 'sent', result: emailResult });
            }

            // KakaoTalk notification
            if (this.kakaoAdapter && reservation.kakao_id) {
                const kakaoResult = await this.sendConfirmationKakao(reservation, options);
                notifications.push({ type: 'kakao', status: 'sent', result: kakaoResult });
            }

            // Log to outbox for retry mechanism
            await this.logToOutbox('confirmation', reservation, notifications);

            return {
                success: true,
                notifications,
                reservation_id: reservation.id
            };

        } catch (error) {
            console.error('❌ Confirmation notification error:', error);
            await this.logToOutbox('confirmation', reservation, notifications, error.message);
            throw error;
        }
    }

    /**
     * Send cancellation notification
     * @param {Object} reservation - Reservation data
     * @param {string} reason - Cancellation reason
     */
    async sendCancellationNotification(reservation, reason = '') {
        const notifications = [];

        try {
            // Email notification
            if (this.emailTransporter && reservation.email) {
                const emailResult = await this.sendCancellationEmail(reservation, reason);
                notifications.push({ type: 'email', status: 'sent', result: emailResult });
            }

            // KakaoTalk notification
            if (this.kakaoAdapter && reservation.kakao_id) {
                const kakaoResult = await this.sendCancellationKakao(reservation, reason);
                notifications.push({ type: 'kakao', status: 'sent', result: kakaoResult });
            }

            await this.logToOutbox('cancellation', reservation, notifications);

            return {
                success: true,
                notifications,
                reservation_id: reservation.id
            };

        } catch (error) {
            console.error('❌ Cancellation notification error:', error);
            await this.logToOutbox('cancellation', reservation, notifications, error.message);
            throw error;
        }
    }

    /**
     * Send reminder notification (D-1, D-0)
     * @param {Object} reservation - Reservation data
     * @param {string} reminderType - 'day_before' or 'day_of'
     */
    async sendReminderNotification(reservation, reminderType) {
        const notifications = [];

        try {
            // Email notification
            if (this.emailTransporter && reservation.email) {
                const emailResult = await this.sendReminderEmail(reservation, reminderType);
                notifications.push({ type: 'email', status: 'sent', result: emailResult });
            }

            // KakaoTalk notification
            if (this.kakaoAdapter && reservation.kakao_id) {
                const kakaoResult = await this.sendReminderKakao(reservation, reminderType);
                notifications.push({ type: 'kakao', status: 'sent', result: kakaoResult });
            }

            await this.logToOutbox('reminder', reservation, notifications);

            return {
                success: true,
                notifications,
                reservation_id: reservation.id,
                reminder_type: reminderType
            };

        } catch (error) {
            console.error('❌ Reminder notification error:', error);
            await this.logToOutbox('reminder', reservation, notifications, error.message);
            throw error;
        }
    }

    /**
     * Send confirmation email
     */
    async sendConfirmationEmail(reservation, options) {
        if (!this.emailTransporter) {
            throw new Error('Email transporter not configured');
        }

        const subject = `[괌세이브카드] 예약 확인 - ${reservation.product_name}`;
        const html = this.generateConfirmationEmailHTML(reservation, options);

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: reservation.email,
            subject,
            html,
            attachments: options.attachments || []
        };

        const result = await this.emailTransporter.sendMail(mailOptions);
        return { messageId: result.messageId, accepted: result.accepted };
    }

    /**
     * Send cancellation email
     */
    async sendCancellationEmail(reservation, reason) {
        if (!this.emailTransporter) {
            throw new Error('Email transporter not configured');
        }

        const subject = `[괌세이브카드] 예약 취소 안내 - ${reservation.product_name}`;
        const html = this.generateCancellationEmailHTML(reservation, reason);

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: reservation.email,
            subject,
            html
        };

        const result = await this.emailTransporter.sendMail(mailOptions);
        return { messageId: result.messageId, accepted: result.accepted };
    }

    /**
     * Send reminder email
     */
    async sendReminderEmail(reservation, reminderType) {
        if (!this.emailTransporter) {
            throw new Error('Email transporter not configured');
        }

        const isToday = reminderType === 'day_of';
        const subject = `[괌세이브카드] ${isToday ? '오늘' : '내일'} 예약 안내 - ${reservation.product_name}`;
        const html = this.generateReminderEmailHTML(reservation, reminderType);

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: reservation.email,
            subject,
            html
        };

        const result = await this.emailTransporter.sendMail(mailOptions);
        return { messageId: result.messageId, accepted: result.accepted };
    }

    /**
     * Send KakaoTalk confirmation
     */
    async sendConfirmationKakao(reservation, options) {
        if (!this.kakaoAdapter) {
            throw new Error('KakaoTalk adapter not configured');
        }

        // Placeholder for actual KakaoTalk API integration
        const message = {
            template_code: 'RESERVATION_CONFIRM',
            recipient: reservation.kakao_id,
            variables: {
                name: reservation.korean_name,
                product: reservation.product_name,
                date: reservation.usage_date,
                time: reservation.usage_time,
                amount: reservation.total_amount,
                reservation_number: reservation.reservation_number
            }
        };

        // Simulate API call
        console.log('📱 KakaoTalk confirmation sent:', message);
        return { success: true, message_id: `kakao_${Date.now()}` };
    }

    /**
     * Send KakaoTalk cancellation
     */
    async sendCancellationKakao(reservation, reason) {
        if (!this.kakaoAdapter) {
            throw new Error('KakaoTalk adapter not configured');
        }

        const message = {
            template_code: 'RESERVATION_CANCEL',
            recipient: reservation.kakao_id,
            variables: {
                name: reservation.korean_name,
                product: reservation.product_name,
                reservation_number: reservation.reservation_number,
                reason: reason || '고객 요청'
            }
        };

        console.log('📱 KakaoTalk cancellation sent:', message);
        return { success: true, message_id: `kakao_${Date.now()}` };
    }

    /**
     * Send KakaoTalk reminder
     */
    async sendReminderKakao(reservation, reminderType) {
        if (!this.kakaoAdapter) {
            throw new Error('KakaoTalk adapter not configured');
        }

        const message = {
            template_code: reminderType === 'day_of' ? 'RESERVATION_TODAY' : 'RESERVATION_TOMORROW',
            recipient: reservation.kakao_id,
            variables: {
                name: reservation.korean_name,
                product: reservation.product_name,
                date: reservation.usage_date,
                time: reservation.usage_time || '시간 미정'
            }
        };

        console.log('📱 KakaoTalk reminder sent:', message);
        return { success: true, message_id: `kakao_${Date.now()}` };
    }

    /**
     * Generate confirmation email HTML
     */
    generateConfirmationEmailHTML(reservation, options) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>예약 확인</title>
            <style>
                body { font-family: 'Noto Sans KR', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(45deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; }
                .label { font-weight: bold; color: #495057; }
                .value { color: #212529; }
                .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎉 예약이 확정되었습니다!</h1>
                    <p>괌세이브카드와 함께하는 특별한 여행</p>
                </div>
                <div class="content">
                    <div class="info-row">
                        <span class="label">예약번호:</span>
                        <span class="value">${reservation.reservation_number}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">상품명:</span>
                        <span class="value">${reservation.product_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">예약자:</span>
                        <span class="value">${reservation.korean_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">이용일:</span>
                        <span class="value">${reservation.usage_date}</span>
                    </div>
                    ${reservation.usage_time ? `
                    <div class="info-row">
                        <span class="label">이용시간:</span>
                        <span class="value">${reservation.usage_time}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="label">인원:</span>
                        <span class="value">성인 ${reservation.people_adult}명, 소아 ${reservation.people_child}명</span>
                    </div>
                    <div class="info-row">
                        <span class="label">총 금액:</span>
                        <span class="value">$${reservation.total_amount}</span>
                    </div>
                    ${reservation.memo ? `
                    <div class="info-row">
                        <span class="label">특별 요청사항:</span>
                        <span class="value">${reservation.memo}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="footer">
                    <p>문의사항이 있으시면 언제든 연락주세요.</p>
                    <p>괌세이브카드 | 고객센터: 1588-0000</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate cancellation email HTML
     */
    generateCancellationEmailHTML(reservation, reason) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>예약 취소 안내</title>
            <style>
                body { font-family: 'Noto Sans KR', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #dc3545; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; }
                .label { font-weight: bold; color: #495057; }
                .value { color: #212529; }
                .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>예약이 취소되었습니다</h1>
                    <p>취소 처리가 완료되었습니다</p>
                </div>
                <div class="content">
                    <div class="info-row">
                        <span class="label">예약번호:</span>
                        <span class="value">${reservation.reservation_number}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">상품명:</span>
                        <span class="value">${reservation.product_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">예약자:</span>
                        <span class="value">${reservation.korean_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">취소일:</span>
                        <span class="value">${new Date().toLocaleDateString('ko-KR')}</span>
                    </div>
                    ${reason ? `
                    <div class="info-row">
                        <span class="label">취소 사유:</span>
                        <span class="value">${reason}</span>
                    </div>
                    ` : ''}
                    <p style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px; border-left: 4px solid #ffc107;">
                        환불 처리는 결제 수단에 따라 3-7일 소요될 수 있습니다.
                    </p>
                </div>
                <div class="footer">
                    <p>문의사항이 있으시면 언제든 연락주세요.</p>
                    <p>괌세이브카드 | 고객센터: 1588-0000</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate reminder email HTML
     */
    generateReminderEmailHTML(reservation, reminderType) {
        const isToday = reminderType === 'day_of';
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>예약 리마인더</title>
            <style>
                body { font-family: 'Noto Sans KR', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(45deg, #28a745, #20c997); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; }
                .label { font-weight: bold; color: #495057; }
                .value { color: #212529; }
                .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
                .highlight { background: #d4edda; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔔 ${isToday ? '오늘' : '내일'} 예약 안내</h1>
                    <p>곧 다가오는 예약을 확인해주세요</p>
                </div>
                <div class="content">
                    <div class="highlight">
                        <strong>${isToday ? '오늘' : '내일'} 이용 예정인 예약이 있습니다!</strong>
                    </div>
                    <div class="info-row">
                        <span class="label">예약번호:</span>
                        <span class="value">${reservation.reservation_number}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">상품명:</span>
                        <span class="value">${reservation.product_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">이용일:</span>
                        <span class="value">${reservation.usage_date}</span>
                    </div>
                    ${reservation.usage_time ? `
                    <div class="info-row">
                        <span class="label">이용시간:</span>
                        <span class="value">${reservation.usage_time}</span>
                    </div>
                    ` : ''}
                    <div class="info-row">
                        <span class="label">인원:</span>
                        <span class="value">성인 ${reservation.people_adult}명, 소아 ${reservation.people_child}명</span>
                    </div>
                    <p style="margin-top: 20px; padding: 15px; background: #cce5ff; border-radius: 5px; border-left: 4px solid #007bff;">
                        즐거운 여행 되시기 바랍니다! 🌴
                    </p>
                </div>
                <div class="footer">
                    <p>문의사항이 있으시면 언제든 연락주세요.</p>
                    <p>괌세이브카드 | 고객센터: 1588-0000</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Log notification to outbox for retry mechanism
     */
    async logToOutbox(type, reservation, notifications, error = null) {
        try {
            // This would typically insert into email_outbox table
            console.log('📝 Notification logged to outbox:', {
                type,
                reservation_id: reservation.id,
                notifications: notifications.length,
                error
            });
        } catch (logError) {
            console.error('❌ Failed to log to outbox:', logError);
        }
    }
}

module.exports = NotifyService;
