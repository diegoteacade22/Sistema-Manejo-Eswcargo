
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Upload, Trash2, DollarSign, PieChart, Landmark } from 'lucide-react';
import { getExpenses, createExpense, deleteExpense, importExpensesFromCsv, deleteAllExpenses } from './actions';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, Filter, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);

    // Filtros y Ordenamiento
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [monthFilter, setMonthFilter] = useState<string>('all');
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

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
                console.log("Archivo leído, enviando al servidor...");

                try {
                    const res = await importExpensesFromCsv(text);
                    if (res.success) {
                        toast.success(`¡Éxito! Importados ${res.count} gastos.`);
                        loadExpenses();
                    } else {
                        toast.error('El servidor no pudo procesar el archivo');
                    }
                } catch (error) {
                    console.error("Error en Server Action:", error);
                    toast.error('Error de comunicación con el servidor');
                } finally {
                    setIsImporting(false);
                    // Reset input so the same file can be uploaded again
                    e.target.value = '';
                }
            };
            reader.onerror = () => {
                toast.error('Error al leer el archivo local');
                setIsImporting(false);
            };
            reader.readAsText(file);
        } catch (error) {
            console.error("Error en FileReader:", error);
            setIsImporting(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('¿Seguro que desea eliminar este gasto?')) return;
        await deleteExpense(id);
        toast.success('Gasto eliminado');
        loadExpenses();
    };

    const handleDeleteAll = async () => {
        if (!confirm('⚠️ ATENCIÓN: ¿Seguro que desea eliminar TODOS los gastos? Esta acción no se puede deshacer.')) return;
        await deleteAllExpenses();
        toast.success('Todos los gastos han sido eliminados');
        loadExpenses();
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Lógica de Filtrado
    const filteredExpenses = expenses.filter(e => {
        const date = new Date(e.date);
        const monthYear = `${date.getMonth() + 1}-${date.getFullYear()}`;
        const matchCategory = categoryFilter === 'all' || e.category === categoryFilter;
        const matchMonth = monthFilter === 'all' || monthYear === monthFilter;
        return matchCategory && matchMonth;
    });

    // Lógica de Ordenamiento
    const sortedExpenses = [...filteredExpenses].sort((a, b) => {
        if (!sortConfig) return 0;
        const { key, direction } = sortConfig;

        let valA = a[key];
        let valB = b[key];

        if (key === 'date') {
            valA = new Date(a.date).getTime();
            valB = new Date(b.date).getTime();
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
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

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const subTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Análisis Financiero Simple
    const getFinancialAnalysis = () => {
        if (expenses.length === 0) return null;

        const sortedByDate = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestDate = new Date(sortedByDate[0].date);
        const currentMonth = latestDate.getMonth();
        const currentYear = latestDate.getFullYear();

        const thisMonthTotal = expenses
            .filter(e => {
                const d = new Date(e.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            })
            .reduce((sum, e) => sum + e.amount, 0);

        const lastMonthTotal = expenses
            .filter(e => {
                const d = new Date(e.date);
                const lastM = currentMonth === 0 ? 11 : currentMonth - 1;
                const lastY = currentMonth === 0 ? currentYear - 1 : currentYear;
                return d.getMonth() === lastM && d.getFullYear() === lastY;
            })
            .reduce((sum, e) => sum + e.amount, 0);

        const trend = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;
        const topCategory = categories.map(cat => ({
            name: cat,
            total: expenses.filter(e => e.category === cat).reduce((sum, ex) => sum + ex.amount, 0)
        })).sort((a, b) => b.total - a.total)[0];

        return { thisMonthTotal, lastMonthTotal, trend, topCategory };
    };

    const analysis = getFinancialAnalysis();

    const formatAmount = (amount: number) => {
        if (amount >= 1e15) return `USD ${amount.toExponential(2)}`; // Notación científica para extremos
        if (amount >= 1e12) return `USD ${(amount / 1e12).toFixed(1)}T`;
        if (amount >= 1e9) return `USD ${(amount / 1e9).toFixed(1)}B`;
        if (amount >= 1e6) return `USD ${(amount / 1e6).toFixed(1)}M`;
        return `USD ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}`;
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <Landmark className="h-10 w-10 text-red-500" />
                        Control de Gastos
                    </h1>
                    <p className="text-slate-500 mt-2 text-lg">Administración de egresos operativos y análisis de burn-rate.</p>
                </div>
                <div className="flex gap-4 items-center">
                    <Button
                        variant="ghost"
                        onClick={handleDeleteAll}
                        className="text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Borrar todos los gastos"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="relative">
                        <input
                            id="csv-upload"
                            type="file"
                            accept=".csv"
                            onChange={handleFileUpload}
                            className="hidden"
                            disabled={isImporting}
                        />
                        <Button
                            variant="outline"
                            className="gap-2 border-red-200 hover:bg-red-50 text-red-600 dark:border-red-900 dark:hover:bg-red-950"
                            asChild
                            disabled={isImporting}
                        >
                            <label htmlFor="csv-upload" className="cursor-pointer flex items-center gap-2">
                                <Upload className="h-4 w-4" />
                                {isImporting ? 'Procesando...' : 'Importar CSV'}
                            </label>
                        </Button>
                    </div>
                    <Button className="gap-2 bg-red-600 hover:bg-red-700 text-white">
                        <Plus className="h-4 w-4" />
                        Nuevo Gasto
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-slate-900 border-red-100 dark:border-red-900 shadow-xl overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-red-600 uppercase tracking-widest flex items-center gap-2">
                            <DollarSign className="h-4 w-4" /> Egresos Totales
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-hidden">
                        <div className="text-xl md:text-2xl font-black text-slate-900 dark:text-white break-all leading-tight">
                            {formatAmount(totalExpenses)}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Histórico completo</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/20 dark:to-slate-900 border-indigo-100 dark:border-indigo-900 shadow-xl">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                            <Filter className="h-4 w-4" /> Subtotal Filtrado
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                            {formatAmount(subTotal)}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Según filtros aplicados</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/20 dark:to-slate-900 border-slate-200 dark:border-slate-800 shadow-xl">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2">
                            <PieChart className="h-4 w-4" /> Categorías
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                            {new Set(expenses.map(e => e.category)).size}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Sectores identificados</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-orange-50 to-white dark:from-orange-950/20 dark:to-slate-900 border-orange-100 dark:border-orange-900 shadow-xl">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" /> Mayor Gasto
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-sm font-black text-slate-900 dark:text-white truncate" title={analysis?.topCategory?.name}>
                            {analysis?.topCategory?.name || 'N/A'}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{analysis?.topCategory ? formatAmount(analysis.topCategory.total) : '-'}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Barra de Filtros */}
            <Card className="p-4 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm">
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-tighter">Filtrar por:</span>
                    </div>

                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-[200px] bg-white dark:bg-slate-950">
                            <SelectValue placeholder="Todas las categorías" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas las categorías</SelectItem>
                            {categories.map(cat => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={monthFilter} onValueChange={setMonthFilter}>
                        <SelectTrigger className="w-[180px] bg-white dark:bg-slate-950">
                            <SelectValue placeholder="Todos los meses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los meses</SelectItem>
                            {months.map(m => {
                                const [month, year] = m.split('-');
                                const date = new Date(Number(year), Number(month) - 1);
                                const label = date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
                                return <SelectItem key={m} value={m}>{label}</SelectItem>;
                            })}
                        </SelectContent>
                    </Select>

                    {(categoryFilter !== 'all' || monthFilter !== 'all') && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setCategoryFilter('all'); setMonthFilter('all'); }}
                            className="text-slate-500 hover:text-red-500"
                        >
                            Limpiar Filtros
                        </Button>
                    )}

                    <div className="ml-auto flex items-center gap-4 text-xs font-bold text-slate-400 mr-4">
                        <span>MOSTRANDO: <span className="text-slate-900 dark:text-white">{filteredExpenses.length}</span> REGISTROS</span>
                    </div>
                </div>
            </Card>

            {/* Análisis Financiero */}
            {analysis && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/10 backdrop-blur-sm">
                        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                            <CardTitle className="text-xs font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                                <TrendingUp className="h-3 w-3" /> Tendencia Mensual
                            </CardTitle>
                            {analysis.trend > 0 ? (
                                <Badge className="bg-red-100 text-red-600 hover:bg-red-100 border-none">
                                    <TrendingUp className="h-3 w-3 mr-1" /> +{analysis.trend.toFixed(1)}%
                                </Badge>
                            ) : (
                                <Badge className="bg-emerald-100 text-emerald-600 hover:bg-emerald-100 border-none">
                                    <TrendingDown className="h-3 w-3 mr-1" /> {analysis.trend.toFixed(1)}%
                                </Badge>
                            )}
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                            <p className="text-xs text-slate-500">
                                El gasto este mes es de <span className="font-bold text-slate-900 dark:text-white">{formatAmount(analysis.thisMonthTotal)}</span> frente a <span className="font-bold">{formatAmount(analysis.lastMonthTotal)}</span> del mes pasado.
                            </p>
                        </CardContent>
                    </Card>

                    <Card className="border-blue-100 dark:border-blue-900/30 bg-blue-50/10 backdrop-blur-sm">
                        <CardHeader className="py-3 px-4">
                            <CardTitle className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                <AlertTriangle className="h-3 w-3" /> Insight de Gestión
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                            <p className="text-xs text-slate-500">
                                La categoría <span className="font-bold text-blue-600 underline">{analysis.topCategory?.name}</span> representa la mayor fuga de capital histórico ({((analysis.topCategory?.total / (totalExpenses || 1)) * 100).toFixed(1)}% del total).
                                Sugerencia: Renegociar proveedores en este sector.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Card className="border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50 dark:bg-slate-900">
                        <TableRow>
                            <TableHead className="font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('date')}>
                                <div className="flex items-center gap-2">Fecha <ArrowUpDown className="h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('category')}>
                                <div className="flex items-center gap-2">Categoría <ArrowUpDown className="h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="font-bold">Descripción</TableHead>
                            <TableHead className="font-bold text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('amount')}>
                                <div className="flex items-center gap-2 justify-end">Monto <ArrowUpDown className="h-3 w-3" /></div>
                            </TableHead>
                            <TableHead className="font-bold text-center">Unidad</TableHead>
                            <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-10">Cargando egresos...</TableCell></TableRow>
                        ) : sortedExpenses.length === 0 ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-10 italic text-slate-400">No hay gastos que coincidan con los filtros.</TableCell></TableRow>
                        ) : (
                            sortedExpenses.map((expense) => (
                                <TableRow key={expense.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                    <TableCell className="font-medium">{new Date(expense.date).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 uppercase">
                                            {expense.category}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-400 max-w-[200px] truncate" title={expense.description}>
                                        {expense.description}
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-red-500 font-mono">
                                        <span title={expense.amount.toString()}>
                                            {formatAmount(expense.amount)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                            {expense.businessUnit}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDelete(expense.id)}
                                            className="text-slate-400 hover:text-red-600 transition-colors"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>
        </div >
    );
}
