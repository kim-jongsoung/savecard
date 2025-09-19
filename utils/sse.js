/**
 * Server-Sent Events (SSE) utilities
 * Real-time notifications for booking operations
 */

class SSEManager {
    constructor() {
        this.clients = new Set();
        this.eventHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Add new SSE client
     * @param {Object} res - Express response object
     * @param {string} clientId - Unique client identifier
     */
    addClient(res, clientId = null) {
        const client = {
            id: clientId || `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            res,
            connectedAt: new Date(),
            lastPing: new Date()
        };

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // Send initial connection event
        this.sendToClient(client, {
            type: 'connection',
            data: {
                clientId: client.id,
                connectedAt: client.connectedAt.toISOString(),
                message: 'Connected to booking events stream'
            }
        });

        // Send recent events to new client
        this.sendRecentEvents(client);

        this.clients.add(client);

        // Handle client disconnect
        res.on('close', () => {
            this.removeClient(client);
        });

        // Set up ping interval
        const pingInterval = setInterval(() => {
            if (this.clients.has(client)) {
                this.ping(client);
            } else {
                clearInterval(pingInterval);
            }
        }, 30000); // Ping every 30 seconds

        console.log(`📡 SSE client connected: ${client.id} (${this.clients.size} total)`);
        return client;
    }

    /**
     * Remove SSE client
     * @param {Object} client - Client object
     */
    removeClient(client) {
        this.clients.delete(client);
        console.log(`📡 SSE client disconnected: ${client.id} (${this.clients.size} remaining)`);
    }

    /**
     * Send event to specific client
     * @param {Object} client - Client object
     * @param {Object} event - Event data
     */
    sendToClient(client, event) {
        try {
            const eventData = {
                id: `event_${Date.now()}`,
                timestamp: new Date().toISOString(),
                ...event
            };

            client.res.write(`id: ${eventData.id}\n`);
            client.res.write(`event: ${eventData.type}\n`);
            client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            
            client.lastPing = new Date();
        } catch (error) {
            console.error(`❌ Failed to send SSE event to client ${client.id}:`, error.message);
            this.removeClient(client);
        }
    }

    /**
     * Broadcast event to all clients
     * @param {Object} event - Event data
     */
    broadcast(event) {
        const eventData = {
            id: `event_${Date.now()}`,
            timestamp: new Date().toISOString(),
            ...event
        };

        // Add to history
        this.addToHistory(eventData);

        // Send to all connected clients
        const disconnectedClients = [];
        
        for (const client of this.clients) {
            try {
                client.res.write(`id: ${eventData.id}\n`);
                client.res.write(`event: ${eventData.type}\n`);
                client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
                
                client.lastPing = new Date();
            } catch (error) {
                console.error(`❌ Failed to broadcast to client ${client.id}:`, error.message);
                disconnectedClients.push(client);
            }
        }

        // Remove disconnected clients
        disconnectedClients.forEach(client => this.removeClient(client));

        console.log(`📡 Broadcasted ${event.type} event to ${this.clients.size} clients`);
    }

    /**
     * Send ping to keep connection alive
     * @param {Object} client - Client object
     */
    ping(client) {
        try {
            client.res.write(`: ping ${Date.now()}\n\n`);
            client.lastPing = new Date();
        } catch (error) {
            console.error(`❌ Failed to ping client ${client.id}:`, error.message);
            this.removeClient(client);
        }
    }

    /**
     * Send recent events to newly connected client
     * @param {Object} client - Client object
     */
    sendRecentEvents(client) {
        const recentEvents = this.eventHistory.slice(-10); // Last 10 events
        
        for (const event of recentEvents) {
            this.sendToClient(client, {
                type: 'history',
                data: event
            });
        }
    }

    /**
     * Add event to history
     * @param {Object} event - Event data
     */
    addToHistory(event) {
        this.eventHistory.push(event);
        
        // Trim history if too large
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Get client statistics
     * @returns {Object} - Client stats
     */
    getStats() {
        const now = new Date();
        const clients = Array.from(this.clients);
        
        return {
            total_clients: clients.length,
            active_clients: clients.filter(c => (now - c.lastPing) < 60000).length, // Active in last minute
            oldest_connection: clients.length > 0 ? 
                Math.min(...clients.map(c => now - c.connectedAt)) / 1000 : 0,
            event_history_size: this.eventHistory.length,
            recent_events: this.eventHistory.slice(-5)
        };
    }

    /**
     * Send booking-specific events
     */
    sendBookingEvent(type, data) {
        this.broadcast({
            type: `booking.${type}`,
            data
        });
    }

    /**
     * Send system events
     */
    sendSystemEvent(type, data) {
        this.broadcast({
            type: `system.${type}`,
            data
        });
    }

    /**
     * Clean up disconnected clients
     */
    cleanup() {
        const now = new Date();
        const staleClients = [];
        
        for (const client of this.clients) {
            // Remove clients that haven't pinged in 2 minutes
            if ((now - client.lastPing) > 120000) {
                staleClients.push(client);
            }
        }
        
        staleClients.forEach(client => {
            console.log(`🧹 Cleaning up stale SSE client: ${client.id}`);
            this.removeClient(client);
        });
        
        return staleClients.length;
    }

    /**
     * Shutdown all connections
     */
    shutdown() {
        console.log('🔌 Shutting down SSE manager...');
        
        for (const client of this.clients) {
            try {
                client.res.write(`event: shutdown\n`);
                client.res.write(`data: {"message": "Server shutting down"}\n\n`);
                client.res.end();
            } catch (error) {
                // Ignore errors during shutdown
            }
        }
        
        this.clients.clear();
        this.eventHistory = [];
    }
}

/**
 * Express middleware for SSE endpoint
 */
function createSSEEndpoint(sseManager) {
    return (req, res) => {
        const clientId = req.query.clientId || req.headers['x-client-id'];
        sseManager.addClient(res, clientId);
    };
}

/**
 * Express middleware to add SSE manager to app locals
 */
function setupSSE(app) {
    const sseManager = new SSEManager();
    
    // Add to app locals for access in routes
    app.locals.sseManager = sseManager;
    app.locals.sseClients = sseManager.clients; // For backward compatibility
    
    // Create SSE endpoint
    app.get('/events', createSSEEndpoint(sseManager));
    
    // Cleanup interval
    const cleanupInterval = setInterval(() => {
        sseManager.cleanup();
    }, 60000); // Cleanup every minute
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
        clearInterval(cleanupInterval);
        sseManager.shutdown();
    });
    
    process.on('SIGINT', () => {
        clearInterval(cleanupInterval);
        sseManager.shutdown();
    });
    
    console.log('✅ SSE manager initialized');
    return sseManager;
}

module.exports = {
    SSEManager,
    createSSEEndpoint,
    setupSSE
};
