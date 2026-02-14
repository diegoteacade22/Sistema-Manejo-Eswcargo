
'use server'

import { prisma } from '@/lib/prisma';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { requireAdminUser } from '@/lib/access';

export async function getFinancialAnalytics(monthsToAnalyze: number = 6) {
    await requireAdminUser();
    console.log(`[Analytics] Analyzing last ${monthsToAnalyze} months`);
    const now = new Date();
    const rangeStart = startOfMonth(subMonths(now, monthsToAnalyze - 1));

    const orders = await prisma.order.findMany({
        where: { date: { gte: rangeStart } },
        include: { items: true }
    });

    const shipments = await prisma.shipment.findMany({
        where: { createdAt: { gte: rangeStart } }
    });

    const expenses = await (prisma as any).expense.findMany({
        where: { date: { gte: rangeStart } }
    });

    const months = [];
    for (let i = monthsToAnalyze - 1; i >= 0; i--) {
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
        const salesCost = salesRevenue - salesProfit;

        const logisticsRevenue = monthShipments.reduce((sum: number, s: any) => sum + (s.price_total || 0), 0);
        const logisticsCost = monthShipments.reduce((sum: number, s: any) => sum + (s.cost_total || 0), 0);
        const logisticsProfit = logisticsRevenue - logisticsCost;

        const totalOperationalExpenses = monthExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);
        const cogs = salesCost + logisticsCost;

        const netProfit = (salesProfit + logisticsProfit) - totalOperationalExpenses;
        const totalRevenue = salesRevenue + logisticsRevenue;

        // Ensure we don't divide by zero for specific month calculations
        // margin = NetProfit / Revenue
        const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        months.push({
            name: monthLabel,
            revenue: totalRevenue,
            grossProfit: salesProfit + logisticsProfit,
            cogs: cogs,
            opex: totalOperationalExpenses,
            expenses: cogs + totalOperationalExpenses, // Total Outflow (Chart convenience)
            netProfit: netProfit,
            margin: margin
        });
    }

    // Handle case where we might have less data than requested, but array length is fixed by loop
    const currentMonth = months[months.length - 1];
    const previousMonth = months[months.length - 2];
    const momGrowth = previousMonth && previousMonth.revenue > 0 ? ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) * 100 : 0;

    // Burn Rate: Average OpEx of the last 3 months (to smooth out anomalies or empty current/last month)
    // We take the last 3 available entries.
    const last3Months = months.slice(-3);
    const burnRate = last3Months.length > 0
        ? last3Months.reduce((sum, m) => sum + m.opex, 0) / last3Months.length
        : 0;

    // Efficiency Ratio: OpEx / Revenue (Average of period of last 3 months to be stable)
    // Actually, "Efficiency Ratio" typically refers to the period being analyzed or TTM. Let's use Last Month but safe.
    // Or better, Total OpEx / Total Revenue of specific period for a "Period Efficiency".
    // Let's stick to Current Month Snapshot but safer, or Average?
    // Let's use Average of last 3 months to align with Burn Rate stability.
    const avgRev3m = last3Months.reduce((sum, m) => sum + m.revenue, 0) / (last3Months.length || 1);
    const efficiencyRatio = avgRev3m > 0 ? (burnRate / avgRev3m) * 100 : 0;

    return {
        monthlyData: months,
        summary: {
            totalRevenue: months.reduce((sum: number, m: any) => sum + m.revenue, 0),
            totalNetProfit: months.reduce((sum: number, m: any) => sum + m.netProfit, 0),
            // Use Weighted Average Margin (Total Profit / Total Revenue) instead of simple average of percentages
            avgMargin: months.reduce((sum: number, m: any) => sum + m.revenue, 0) > 0
                ? (months.reduce((sum: number, m: any) => sum + m.netProfit, 0) / months.reduce((sum: number, m: any) => sum + m.revenue, 0)) * 100
                : 0,
            burnRate: burnRate,
            momGrowth,
            efficiencyRatio
        }
    };
}

export async function getLogisticsAnalytics(monthsToAnalyze: number = 6) {
    await requireAdminUser();
    const now = new Date();
    const rangeStart = startOfMonth(subMonths(now, monthsToAnalyze - 1));

    const shipments = await prisma.shipment.findMany({
        where: {
            status: 'ENTREGADO',
            date_arrived: { gte: rangeStart }
        },
        orderBy: { date_arrived: 'desc' }
    });

    if (shipments.length === 0) return null;

    const totalWeight = shipments.reduce((sum: number, s: any) => sum + (s.weight_cli || 0), 0);
    const totalCost = shipments.reduce((sum: number, s: any) => sum + (s.cost_total || 0), 0);
    const totalPrice = shipments.reduce((sum: number, s: any) => sum + (s.price_total || 0), 0);

    const costPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
    const revPerKg = totalWeight > 0 ? totalPrice / totalWeight : 0;

    const typeSummary = shipments.reduce((acc: any, s: any) => {
        const type = s.type_load || 'OTRO';
        if (!acc[type]) acc[type] = { count: 0, weight: 0, profit: 0, revenue: 0 };
        acc[type].count++;
        const profit = s.profit || ((s.price_total || 0) - (s.cost_total || 0));
        acc[type].weight += (s.weight_cli || 0);
        acc[type].profit += profit;
        acc[type].revenue += (s.price_total || 0);
        return acc;
    }, {});

    return {
        kpis: {
            avgCostPerKg: costPerKg,
            avgRevPerKg: revPerKg,
            logisticsMargin: totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice * 100) : 0,
            yieldPerKg: totalWeight > 0 ? (totalPrice - totalCost) / totalWeight : 0,
            totalKgProcessed: totalWeight
        },
        typeSummary: Object.entries(typeSummary).map(([name, data]: [string, any]) => ({
            name,
            ...data,
            margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0
        }))
    };
}

export async function getSalesAnalytics(monthsToAnalyze: number = 6) {
    await requireAdminUser();
    const now = new Date();
    const rangeStart = startOfMonth(subMonths(now, monthsToAnalyze - 1));

    const clients = await prisma.client.findMany({
        include: {
            orders: {
                where: { date: { gte: rangeStart } },
                include: { items: true }
            }
        }
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const clientPerformance = clients.map(c => {
        const totalSpent = c.orders.reduce((sum: number, o: any) => sum + o.total_amount, 0);
        const totalProfit = c.orders.reduce((sum: number, o: any) => sum + o.items.reduce((p: number, item: any) => p + item.profit, 0), 0);
        const orderCount = c.orders.length;
        // Last order date logic is slightly flawed if we only fetch orders in range, but acceptable for "Period Analysis"
        const lastOrderDate = orderCount > 0 ? new Date(Math.max(...c.orders.map(o => o.date.getTime()))) : null;

        return {
            id: c.id,
            name: c.name,
            segment: (c as any).segment || 'REGULAR',
            LTV: totalSpent, // This is now "Period Spend"
            profitability: totalSpent > 0 ? (totalProfit / totalSpent) * 100 : 0,
            avgOrderValue: orderCount > 0 ? totalSpent / orderCount : 0,
            orderCount,
            lastOrderDate
        };
    }).sort((a, b) => b.LTV - a.LTV);

    // activeLast30d still works based on fetched orders (which include last 30d if range covers it)
    const activeLast30d = clientPerformance.filter(c => c.lastOrderDate && c.lastOrderDate >= thirtyDaysAgo).length;
    // churnRisk: LTV > 1000 and NO order in last 30d
    // Note: If range is "Last 12 months", and last order was 2 months ago, they are churn risk.
    const churnRiskCount = clientPerformance.filter(c => c.LTV > 1000 && (!c.lastOrderDate || c.lastOrderDate < thirtyDaysAgo)).length;

    const sourceSummary: any = {};
    const allOrdersInRange = await (prisma as any).order.findMany({
        where: { date: { gte: rangeStart } },
        select: { source: true, total_amount: true }
    });

    allOrdersInRange.forEach((o: any) => {
        const src = o.source || 'DESCONOCIDO';
        if (!sourceSummary[src]) sourceSummary[src] = 0;
        sourceSummary[src] += o.total_amount;
    });

    return {
        topClients: clientPerformance.slice(0, 10),
        stats: {
            activeLast30d,
            churnRiskCount,
            retentionRate: clients.length > 0 ? (activeLast30d / clients.length) * 100 : 0,
            avgLTV: clientPerformance.reduce((acc, c) => acc + c.LTV, 0) / (clients.length || 1)
        },
        sourceSummary: Object.entries(sourceSummary).map(([name, value]) => ({ name, value })),
        atRiskClients: clientPerformance
            .filter(c => c.LTV > 5000 && c.lastOrderDate && (new Date().getTime() - c.lastOrderDate.getTime()) / (1000 * 3600 * 24) > 60)
            .map(c => ({
                ...c,
                totalSpent: c.LTV,
                daysSinceLastOrder: c.lastOrderDate ? Math.floor((new Date().getTime() - c.lastOrderDate.getTime()) / (1000 * 3600 * 24)) : 0
            }))
            .slice(0, 5),
        planCandidates: clientPerformance
            .filter(c => c.orderCount > 8)
            .slice(0, 5)
    };
}

export async function getPurchasingAnalytics(monthsToAnalyze: number = 6) {
    await requireAdminUser();
    const now = new Date();
    const rangeStart = startOfMonth(subMonths(now, monthsToAnalyze - 1));

    const itemAnalysis = await prisma.orderItem.findMany({
        where: {
            unit_cost: { gt: 0 },
            supplierId: { not: null },
            order: { date: { gte: rangeStart } }
        },
        include: { supplier: true }
    });

    const productPrices: any = {};
    itemAnalysis.forEach(item => {
        if (!productPrices[item.productName]) productPrices[item.productName] = {};
        const supplierName = item.supplier?.name || 'Desconocido';
        if (!productPrices[item.productName][supplierName]) {
            productPrices[item.productName][supplierName] = { min: item.unit_cost, max: item.unit_cost, avg: item.unit_cost, count: 1 };
        } else {
            const sp = productPrices[item.productName][supplierName];
            sp.min = Math.min(sp.min, item.unit_cost);
            sp.max = Math.max(sp.max, item.unit_cost);
            sp.avg = (sp.avg * sp.count + item.unit_cost) / (sp.count + 1);
            sp.count++;
        }
    });

    const opportunities: any[] = [];
    Object.entries(productPrices).forEach(([product, suppliers]: [string, any]) => {
        const supplierList = Object.entries(suppliers) as [string, any][];
        if (supplierList.length > 1) {
            const sorted = supplierList.sort((a, b) => a[1].avg - b[1].avg);
            const cheapest = sorted[0];
            const mostExpensive = sorted[sorted.length - 1];
            const diff = (mostExpensive[1].avg as number) - (cheapest[1].avg as number);
            if (diff > 0) {
                opportunities.push({
                    product,
                    cheapestSupplier: cheapest[0],
                    cheapestPrice: cheapest[1].avg,
                    expensiveSupplier: mostExpensive[0],
                    expensivePrice: mostExpensive[1].avg,
                    potentialSavings: diff
                });
            }
        }
    });

    return {
        priceOpportunities: opportunities.sort((a, b) => b.potentialSavings - a.potentialSavings).slice(0, 10)
    };
}
