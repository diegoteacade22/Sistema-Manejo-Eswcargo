
'use server'

import { prisma } from '@/lib/prisma';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

export async function getFinancialAnalytics() {
    const now = new Date();
    const sixMonthsAgo = startOfMonth(subMonths(now, 5));

    // 1. Revenue & Profit from Orders
    const orders = await prisma.order.findMany({
        where: { date: { gte: sixMonthsAgo } },
        include: { items: true }
    });

    // 2. Logistics Income & Costs
    const shipments = await prisma.shipment.findMany({
        where: { createdAt: { gte: sixMonthsAgo } }
    });

    // 3. Operating Expenses
    const expenses = await (prisma as any).expense.findMany({
        where: { date: { gte: sixMonthsAgo } }
    });

    // Process data by month
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(now, i);
        const monthStart = startOfMonth(monthDate);
        const monthEnd = endOfMonth(monthDate);
        const monthLabel = format(monthDate, 'MMM yy');

        const monthOrders = orders.filter(o => o.date >= monthStart && o.date <= monthEnd);
        const monthShipments = shipments.filter(s => (s.date_shipped || s.createdAt) >= monthStart && (s.date_shipped || s.createdAt) <= monthEnd);
        const monthExpenses = expenses.filter((e: any) => e.date >= monthStart && e.date <= monthEnd);

        const salesRevenue = monthOrders.reduce((sum: number, o: any) => sum + o.total_amount, 0);
        const salesProfit = monthOrders.reduce((sum: number, o: any) => {
            return sum + o.items.reduce((p: number, item: any) => p + item.profit, 0);
        }, 0);

        const logisticsRevenue = monthShipments.reduce((sum: number, s: any) => sum + (s.price_total || 0), 0);
        const logisticsCost = monthShipments.reduce((sum: number, s: any) => sum + (s.cost_total || 0), 0);
        const logisticsProfit = logisticsRevenue - logisticsCost;

        const totalOperationalExpenses = monthExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);

        const netProfit = (salesProfit + logisticsProfit) - totalOperationalExpenses;

        months.push({
            name: monthLabel,
            revenue: salesRevenue + logisticsRevenue,
            grossProfit: salesProfit + logisticsProfit,
            expenses: totalOperationalExpenses,
            netProfit: netProfit,
            margin: (salesRevenue + logisticsRevenue) > 0 ? (netProfit / (salesRevenue + logisticsRevenue)) * 100 : 0
        });
    }

    return {
        monthlyData: months,
        summary: {
            totalRevenue: months.reduce((sum: number, m: any) => sum + m.revenue, 0),
            totalNetProfit: months.reduce((sum: number, m: any) => sum + m.netProfit, 0),
            avgMargin: months.length > 0 ? months.reduce((sum: number, m: any) => sum + m.margin, 0) / months.length : 0,
            burnRate: months.length > 0 ? months[months.length - 1].expenses : 0
        }
    };
}

export async function getLogisticsAnalytics() {
    const shipments = await prisma.shipment.findMany({
        where: { status: 'ENTREGADO' },
        take: 50,
        orderBy: { date_arrived: 'desc' }
    });

    if (shipments.length === 0) return null;

    const totalWeight = shipments.reduce((sum: number, s: any) => sum + (s.weight_cli || 0), 0);
    const totalCost = shipments.reduce((sum: number, s: any) => sum + (s.cost_total || 0), 0);
    const totalPrice = shipments.reduce((sum: number, s: any) => sum + (s.price_total || 0), 0);

    // Efficiency: Cost per KG
    const costPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
    const revPerKg = totalWeight > 0 ? totalPrice / totalWeight : 0;

    // Categorize by Load Type (Carga Gral vs Electronics etc)
    const typeSummary = shipments.reduce((acc: any, s: any) => {
        const type = s.type_load || 'OTRO';
        if (!acc[type]) acc[type] = { count: 0, weight: 0, profit: 0 };
        acc[type].count++;
        acc[type].weight += (s.weight_cli || 0);
        acc[type].profit += (s.profit || 0);
        return acc;
    }, {});

    return {
        kpis: {
            avgCostPerKg: costPerKg,
            avgRevPerKg: revPerKg,
            logisticsMargin: (totalPrice - totalCost) / totalPrice * 100,
            totalKgProcessed: totalWeight
        },
        typeSummary: Object.entries(typeSummary).map(([name, data]: [string, any]) => ({ name, ...data }))
    };
}

export async function getSalesAnalytics() {
    const clients = await prisma.client.findMany({
        include: {
            orders: {
                include: { items: true }
            }
        }
    });

    const clientPerformance = clients.map(c => {
        const totalSpent = c.orders.reduce((sum: number, o: any) => sum + o.total_amount, 0);
        const totalProfit = c.orders.reduce((sum: number, o: any) => sum + o.items.reduce((p: number, item: any) => p + item.profit, 0), 0);
        const orderCount = c.orders.length;

        return {
            name: c.name,
            segment: (c as any).segment || 'REGULAR',
            LTV: totalSpent,
            profitability: totalSpent > 0 ? (totalProfit / totalSpent) * 100 : 0,
            avgOrderValue: orderCount > 0 ? totalSpent / orderCount : 0,
            orderCount
        };
    }).sort((a, b) => b.LTV - a.LTV);

    // Group by source (if available)
    const orders = await (prisma as any).order.findMany({ select: { source: true, total_amount: true } });
    const sourceSummary: any = {};
    orders.forEach((o: any) => {
        const src = o.source || 'DESCONOCIDO';
        if (!sourceSummary[src]) sourceSummary[src] = 0;
        sourceSummary[src] += o.total_amount;
    });

    return {
        topClients: clientPerformance.slice(0, 10),
        sourceSummary: Object.entries(sourceSummary).map(([name, value]) => ({ name, value }))
    };
}
