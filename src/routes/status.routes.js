import { Router } from "express";

export function statusRoutes(decisionService){

    const router = Router();

    router.get('/status', (req, res) => {
        const status = decisionService.getStatus();
        res.json({
            ...status,
            server: {
                nodeEnv:process.env.NODE_ENV,
                uptime:process.uptime(),
                memoryUsage: process.memoryUsage()
            }
        })
    })

    return router

}