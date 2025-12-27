
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Upload, Trash2, DollarSign, PieChart, Landmark } from 'lucide-react';
import { getExpenses, createExpense, deleteExpense, importExpensesFromCsv, deleteAllExpenses } from './actions';
import { toast } from 'sonner';

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        loadExpenses();
    }, []);

    const loadExpenses = async () => {
        const data = await getExpenses();
        setExpenses(data);
        setLoading(false);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target?.result as string;
            const res = await importExpensesFromCsv(text);
            if (res.success) {
                toast.success(`Importados ${res.count} gastos correctamente`);
                loadExpenses();
            } else {
                toast.error('Error al importar CSV');
            }
            setIsImporting(false);
        };
        reader.readAsText(file);
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

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

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
                            type="file"
                            accept=".csv"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            disabled={isImporting}
                        />
                        <Button variant="outline" className="gap-2 border-red-200 hover:bg-red-50 text-red-600 dark:border-red-900 dark:hover:bg-red-950">
                            <Upload className="h-4 w-4" />
                            {isImporting ? 'Importando...' : 'Importar CSV'}
                        </Button>
                    </div>
                    <Button className="gap-2 bg-red-600 hover:bg-red-700 text-white">
                        <Plus className="h-4 w-4" />
                        Nuevo Gasto
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-slate-900 border-red-100 dark:border-red-900 shadow-xl overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-red-600 uppercase tracking-widest flex items-center gap-2">
                            <DollarSign className="h-4 w-4" /> Egresos Totales
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white truncate" title={totalExpenses.toString()}>
                            USD {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(totalExpenses)}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Acumulado según registros actuales</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/20 dark:to-slate-900 border-slate-200 dark:border-slate-800 shadow-xl">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2">
                            <PieChart className="h-4 w-4" /> Categorías
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-900 dark:text-white">
                            {new Set(expenses.map(e => e.category)).size}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Sectores de gasto identificados</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/20 dark:to-slate-900 border-slate-200 dark:border-slate-800 shadow-xl">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2">
                            <Upload className="h-4 w-4" /> Formato Requerido
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-[10px] font-mono text-slate-500 leading-tight">
                            Columna A: Fecha<br />
                            Columna C: Descripción<br />
                            Columna D: Monto<br />
                            <span className="text-red-600 font-bold">Columna G: CATEGORIA (Filtro 'ESW')</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50 dark:bg-slate-900">
                        <TableRow>
                            <TableHead className="font-bold">Fecha</TableHead>
                            <TableHead className="font-bold">Categoría</TableHead>
                            <TableHead className="font-bold">Descripción</TableHead>
                            <TableHead className="font-bold text-right">Monto</TableHead>
                            <TableHead className="font-bold text-center">Unidad</TableHead>
                            <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-10">Cargando egresos...</TableCell></TableRow>
                        ) : expenses.length === 0 ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-10 italic text-slate-400">No hay gastos registrados. Importe un CSV para comenzar.</TableCell></TableRow>
                        ) : (
                            expenses.map((expense) => (
                                <TableRow key={expense.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                    <TableCell className="font-medium">{new Date(expense.date).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 uppercase">
                                            {expense.category}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-slate-600 dark:text-slate-400">{expense.description}</TableCell>
                                    <TableCell className="text-right font-black text-red-600">
                                        USD {expense.amount.toFixed(2)}
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
