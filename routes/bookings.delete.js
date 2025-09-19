/**
 * Bookings Delete API
 * DELETE /bookings/:id - Soft delete (cancel) reservation
 * POST /bookings/:id/restore - Restore cancelled reservation
 */

const express = require('express');
const router = express.Router();

/**
 * DELETE /bookings/:id
 * Soft delete reservation (set payment_status to 'cancelled')
 */
router.delete('/:id', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { reason, hard_delete = false } = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';
        const requestId = req.headers['x-request-id'] || `del_${Date.now()}`;

        // Validate ID
        if (!id || isNaN(parseInt(id))) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Invalid reservation ID'
            });
        }

        // Get current reservation
        const currentQuery = `
            SELECT * FROM reservations 
            WHERE id = $1 AND is_deleted = FALSE
            FOR UPDATE
        `;
        
        const currentResult = await client.query(currentQuery, [id]);

        if (currentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const currentReservation = currentResult.rows[0];

        // Check if already cancelled
        if (currentReservation.payment_status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Reservation is already cancelled'
            });
        }

        // Set actor for audit trigger
        await client.query(`SET LOCAL app.current_actor = $1`, [actor]);

        let updateQuery, updateValues, auditAction;

        if (hard_delete) {
            // Hard delete (set is_deleted = true)
            updateQuery = `
                UPDATE reservations 
                SET is_deleted = TRUE, 
                    updated_at = NOW(),
                    lock_version = lock_version + 1
                WHERE id = $1
                RETURNING *
            `;
            updateValues = [id];
            auditAction = 'delete';
        } else {
            // Soft delete (set payment_status to cancelled)
            updateQuery = `
                UPDATE reservations 
                SET payment_status = 'cancelled',
                    review_status = 'cancelled',
                    updated_at = NOW(),
                    lock_version = lock_version + 1
                WHERE id = $1
                RETURNING *
            `;
            updateValues = [id];
            auditAction = 'cancel';
        }

        const updateResult = await client.query(updateQuery, updateValues);
        const updatedReservation = updateResult.rows[0];

        // Create audit entry
        const auditQuery = `
            SELECT create_reservation_audit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;

        const diff = hard_delete ? 
            { is_deleted: { old: false, new: true } } :
            { 
                payment_status: { old: currentReservation.payment_status, new: 'cancelled' },
                review_status: { old: currentReservation.review_status, new: 'cancelled' }
            };

        await client.query(auditQuery, [
            id,
            actor,
            auditAction,
            JSON.stringify(diff),
            JSON.stringify(currentReservation),
            JSON.stringify(updatedReservation),
            reason || (hard_delete ? 'Hard delete' : 'Cancellation'),
            req.ip,
            req.headers['user-agent'],
            requestId
        ]);

        await client.query('COMMIT');

        // Response
        res.json({
            success: true,
            message: hard_delete ? 'Reservation deleted successfully' : 'Reservation cancelled successfully',
            data: {
                id: updatedReservation.id,
                payment_status: updatedReservation.payment_status,
                review_status: updatedReservation.review_status,
                is_deleted: updatedReservation.is_deleted,
                updated_at: updatedReservation.updated_at
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: hard_delete ? 'booking.delete' : 'booking.cancel',
                    booking_id: id,
                    actor,
                    reason: reason || 'No reason provided'
                })}\n\n`);
            });
        }

        // Send notification if configured
        if (req.app.locals.notifyService && !hard_delete) {
            try {
                await req.app.locals.notifyService.sendCancellationNotification(
                    updatedReservation,
                    reason
                );
            } catch (notifyError) {
                console.warn('⚠️ Failed to send cancellation notification:', notifyError.message);
            }
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Booking deletion error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to delete reservation',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * POST /bookings/:id/restore
 * Restore cancelled reservation
 */
router.post('/:id/restore', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { reason, new_status = 'pending' } = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';
        const requestId = req.headers['x-request-id'] || `restore_${Date.now()}`;

        // Validate new status
        const validStatuses = ['pending', 'confirmed'];
        if (!validStatuses.includes(new_status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Invalid new status. Must be pending or confirmed'
            });
        }

        // Get current reservation
        const currentQuery = `
            SELECT * FROM reservations 
            WHERE id = $1 AND (payment_status = 'cancelled' OR is_deleted = TRUE)
            FOR UPDATE
        `;
        
        const currentResult = await client.query(currentQuery, [id]);

        if (currentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Cancelled reservation not found'
            });
        }

        const currentReservation = currentResult.rows[0];

        // Check restore policy (example: only allow restore within 24 hours)
        const cancelledAt = new Date(currentReservation.updated_at);
        const now = new Date();
        const hoursSinceCancellation = (now - cancelledAt) / (1000 * 60 * 60);

        if (hoursSinceCancellation > 24) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                message: 'Cannot restore reservation cancelled more than 24 hours ago',
                cancelled_at: cancelledAt.toISOString(),
                hours_since: Math.round(hoursSinceCancellation)
            });
        }

        // Set actor for audit trigger
        await client.query(`SET LOCAL app.current_actor = $1`, [actor]);

        // Restore reservation
        const updateQuery = `
            UPDATE reservations 
            SET payment_status = $2,
                review_status = 'needs_review',
                is_deleted = FALSE,
                updated_at = NOW(),
                lock_version = lock_version + 1
            WHERE id = $1
            RETURNING *
        `;

        const updateResult = await client.query(updateQuery, [id, new_status]);
        const restoredReservation = updateResult.rows[0];

        // Create audit entry
        const auditQuery = `
            SELECT create_reservation_audit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;

        const diff = {
            payment_status: { old: currentReservation.payment_status, new: new_status },
            review_status: { old: currentReservation.review_status, new: 'needs_review' },
            is_deleted: { old: currentReservation.is_deleted, new: false }
        };

        await client.query(auditQuery, [
            id,
            actor,
            'restore',
            JSON.stringify(diff),
            JSON.stringify(currentReservation),
            JSON.stringify(restoredReservation),
            reason || 'Reservation restored',
            req.ip,
            req.headers['user-agent'],
            requestId
        ]);

        await client.query('COMMIT');

        // Response
        res.json({
            success: true,
            message: 'Reservation restored successfully',
            data: {
                id: restoredReservation.id,
                payment_status: restoredReservation.payment_status,
                review_status: restoredReservation.review_status,
                is_deleted: restoredReservation.is_deleted,
                updated_at: restoredReservation.updated_at
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.restore',
                    booking_id: id,
                    actor,
                    new_status,
                    reason: reason || 'No reason provided'
                })}\n\n`);
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Booking restore error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to restore reservation',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * GET /bookings/:id/restore-eligibility
 * Check if reservation can be restored
 */
router.get('/:id/restore-eligibility', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;

        const query = `
            SELECT 
                id, payment_status, review_status, is_deleted, updated_at,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 as hours_since_update
            FROM reservations 
            WHERE id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const reservation = result.rows[0];
        const hoursSinceUpdate = parseFloat(reservation.hours_since_update);
        
        const canRestore = (
            (reservation.payment_status === 'cancelled' || reservation.is_deleted) &&
            hoursSinceUpdate <= 24
        );

        res.json({
            success: true,
            data: {
                can_restore: canRestore,
                current_status: {
                    payment_status: reservation.payment_status,
                    review_status: reservation.review_status,
                    is_deleted: reservation.is_deleted
                },
                time_info: {
                    updated_at: reservation.updated_at,
                    hours_since_update: Math.round(hoursSinceUpdate * 100) / 100,
                    restore_deadline: hoursSinceUpdate <= 24 ? 
                        new Date(Date.now() + (24 - hoursSinceUpdate) * 60 * 60 * 1000).toISOString() : 
                        null
                },
                reason: canRestore ? null : 
                    hoursSinceUpdate > 24 ? 'Restore window expired (24 hours)' :
                    'Reservation is not cancelled or deleted'
            }
        });

    } catch (error) {
        console.error('❌ Restore eligibility check error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check restore eligibility',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
