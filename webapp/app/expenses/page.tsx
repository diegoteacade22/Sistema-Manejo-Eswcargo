
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Upload, Trash2, DollarSign, PieChart, Landmark, ArrowUpDown, Filter, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { getExpenses, createExpense, deleteExpense, importExpensesFromCsv, deleteAllExpenses } from './actions';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);

    // Vista y Navegación
    const [view, setView] = useState<'summary' | 'detail'>('summary');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Filtros y Ordenamiento
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [monthFilter, setMonthFilter] = useState<string>('all');
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'amount', direction: 'desc' });

    useEffect(() => {
        loadExpenses();
    }, []);

    const loadExpenses = async () => {
        setLoading(true);
        const data = await getExpenses();
        setExpenses(data);
        setLoading(false);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        console.log("Iniciando lectura de archivo:", file.name);
        setIsImporting(true);

        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const text = event.target?.result as string;
                const res = await importExpensesFromCsv(text);
                if (res.success) {
                    toast.success(`¡Éxito! Importados ${res.count} gastos.`);
                    loadExpenses();
                } else {
                    toast.error('Error al procesar el archivo');
                }
                setIsImporting(false);
                e.target.value = '';
            };
            reader.readAsText(file);
        } catch (error) {
            toast.error('Error al abrir el archivo');
            setIsImporting(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('¿Seguro que desea eliminar este gasto?')) return;
        await deleteExpense(id);
        loadExpenses();
    };

    const handleDeleteAll = async () => {
        if (!confirm('⚠️ ¿Seguro que desea eliminar TODO?')) return;
        await deleteAllExpenses();
        loadExpenses();
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Lógica de Filtrado Base
    const filteredExpenses = expenses.filter(e => {
        const date = new Date(e.date);
        const monthYear = `${date.getMonth() + 1}-${date.getFullYear()}`;
        const matchCategory = categoryFilter === 'all' || e.category === categoryFilter;
        const matchMonth = monthFilter === 'all' || monthYear === monthFilter;
        return matchCategory && matchMonth;
    });

    const categories = Array.from(new Set(expenses.map(e => e.category))).sort();
    const months = Array.from(new Set(expenses.map(e => {
        const d = new Date(e.date);
        return `${d.getMonth() + 1}-${d.getFullYear()}`;
    }))).sort((a, b) => {
        const [mA, yA] = a.split('-').map(Number);
        const [mB, yB] = b.split('-').map(Number);
        return yA !== yB ? yB - yA : mB - mA;
    });

    // Cálculos para Cartas
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const subTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Agrupación por Categoría para la Vista Resumen
    const categorySummary = Array.from(new Set(filteredExpenses.map(e => e.category))).map(cat => {
        const catExpenses = filteredExpenses.filter(e => e.category === cat);
        return {
            category: cat,
            amount: catExpenses.reduce((sum, e) => sum + e.amount, 0),
            count: catExpenses.length
        };
    });

    const sortedSummary = [...categorySummary].sort((a, b) => {
        if (!sortConfig) return 0;
        const { key, direction } = sortConfig;
        const valA = key === 'category' ? a.category : a.amount;
        const valB = key === 'category' ? b.category : b.amount;
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Gastos para la Vista Detalle
    const categoryDetails = filteredExpenses
        .filter(e => !selectedCategory || e.category === selectedCategory)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const formatUSDate = (date: Date | string) => {
        const d = new Date(date);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    };

    const formatAmount = (amount: number) => {
        if (amount >= 1e15) return `${amount.toExponential(2)}`;
        if (amount >= 1e12) return `${(amount / 1e12).toFixed(1)}T`;
        if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)}B`;
        if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    // Análisis Financiero Simplificado
    const getFinancialAnalysis = () => {
        if (expenses.length === 0) return null;
        const topCat = sortedSummary[0] || { category: 'N/A', amount: 0 };
        return { topCategory: topCat };
    };
    const analysis = getFinancialAnalysis();

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <Landmark className="h-10 w-10 text-red-500" />
                        Control de Gastos
                    </h1>
                    <p className="text-slate-500 mt-2 text-lg">Resumen agrupado por categorías y detalles por fecha.</p>
                </div>
                <div className="flex gap-4 items-center">
                    <Button variant="ghost" onClick={handleDeleteAll} className="text-slate-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="relative">
                        <input id="csv-upload" type="file" accept=".csv" onChange={handleFileUpload} className="hidden" disabled={isImporting} />
                        <Button variant="outline" className="gap-2 border-red-200 text-red-600" asChild disabled={isImporting}>
                            <label htmlFor="csv-upload" className="cursor-pointer flex items-center gap-2">
                                <Upload className="h-4 w-4" />
                                {isImporting ? '...' : 'Importar CSV'}
                            </label>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-slate-900 border-red-100 shadow-xl">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-red-600 uppercase">Egresos Totales</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black">{formatAmount(totalExpenses)}</div></CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/20 dark:to-slate-900 border-indigo-100 shadow-xl">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-indigo-600 uppercase">Filtro Actual</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black text-indigo-600">{formatAmount(subTotal)}</div></CardContent>
                </Card>
                <Card className="bg-slate-50 border-slate-200 shadow-xl">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-slate-500 uppercase">Categorías</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-black">{categories.length}</div></CardContent>
                </Card>
                <Card className="bg-orange-50 border-orange-100 shadow-xl">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold text-orange-600 uppercase">Top Gasto</CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-sm font-bold truncate">{analysis?.topCategory?.category}</div>
                        <div className="text-lg font-black text-orange-600">{formatAmount(analysis?.topCategory?.amount || 0)}</div>
                    </CardContent>
                </Card>
            </div>

            <Card className="p-4 border-slate-200 bg-slate-50/50 backdrop-blur-sm">
                <div className="flex flex-wrap gap-4 items-center">
                    <Filter className="h-4 w-4 text-slate-400" />
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-[200px]"><SelectValue placeholder="Categoría" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas las categorías</SelectItem>
                            {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={monthFilter} onValueChange={setMonthFilter}>
                        <SelectTrigger className="w-[180px]"><SelectValue placeholder="Mes" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los meses</SelectItem>
                            {months.map(m => {
                                const [month, year] = m.split('-');
                                const date = new Date(Number(year), Number(month) - 1);
                                return <SelectItem key={m} value={m}>{date.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}</SelectItem>;
                            })}
                        </SelectContent>
                    </Select>
                    {(categoryFilter !== 'all' || monthFilter !== 'all') && (
                        <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter('all'); setMonthFilter('all'); }} className="text-red-500">Limpiar</Button>
                    )}
                </div>
            </Card>

            <Card className="border-slate-200 shadow-2xl overflow-hidden">
                <div className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 p-4 flex justify-between items-center">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        {view === 'summary' ? 'Resumen por Categoría' : `Detalle: ${selectedCategory}`}
                    </h3>
                    {view === 'detail' && (
                        <Button variant="link" size="sm" onClick={() => setView('summary')} className="text-red-600 font-bold p-0 h-auto">← Volver</Button>
                    )}
                </div>
                <Table>
                    <TableHeader>
                        {view === 'summary' ? (
                            <TableRow>
                                <TableHead className="font-bold cursor-pointer" onClick={() => handleSort('category')}>
                                    Categoría {sortConfig?.key === 'category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </TableHead>
                                <TableHead className="font-bold text-center">Items</TableHead>
                                <TableHead className="font-bold text-right cursor-pointer" onClick={() => handleSort('amount')}>
                                    Total {sortConfig?.key === 'amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </TableHead>
                                <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                        ) : (
                            <TableRow>
                                <TableHead className="font-bold">Fecha (MM/DD/YYYY)</TableHead>
                                <TableHead className="font-bold">Descripción</TableHead>
                                <TableHead className="font-bold text-right">Monto</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        )}
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={4} className="text-center py-20">Analizando...</TableCell></TableRow>
                        ) : view === 'summary' ? (
                            sortedSummary.map((item) => (
                                <TableRow key={item.category} className="hover:bg-red-50/50 cursor-pointer group" onClick={() => { setSelectedCategory(item.category); setView('detail'); }}>
                                    <TableCell className="font-bold uppercase">{item.category}</TableCell>
                                    <TableCell className="text-center text-slate-400 text-xs">{item.count}</TableCell>
                                    <TableCell className="text-right font-black text-red-600 text-lg">{formatAmount(item.amount)}</TableCell>
                                    <TableCell className="text-right opacity-0 group-hover:opacity-100 text-[10px] font-bold text-red-500">VER →</TableCell>
                                </TableRow>
                            ))
                        ) : (
                            categoryDetails.map((expense) => (
                                <TableRow key={expense.id}>
                                    <TableCell className="font-mono text-xs">{formatUSDate(expense.date)}</TableCell>
                                    <TableCell className="text-slate-600 text-sm">{expense.description}</TableCell>
                                    <TableCell className="text-right font-bold text-red-500">{formatAmount(expense.amount)}</TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(expense.id); }} className="h-6 w-6 text-slate-300 hover:text-red-500"><Trash2 className="h-3 w-3" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>
        </div>
    );
}
