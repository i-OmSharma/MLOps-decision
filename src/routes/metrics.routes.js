import { Router } from "express";
import * as metrics from "../metrics/prometheus.js"

const router = Router();

router.get('/metrics', async (req, res) => {
    try {
        const metricsOutput = await metrics.getMetrics();
        res.set('Content-Type', metrics.getContentType());
        res.send(metricsOutput);
    } catch (error) {
        console.error('Metrics error:', error);
        res.status(500).send('Error generating metrics')
    }
})

export default router