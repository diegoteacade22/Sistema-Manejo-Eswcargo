import { getUsers } from '@/app/user-actions';
import { Button } from '@/components/ui/button';
import { Plus, User, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function UsersPage() {
    const res = await getUsers();
    const users = res.success ? (res.data || []) : [];

    return (
        <div className="p-8 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                    <Link href="/maintenance">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                            Gestión de Usuarios
                        </h2>
                        <p className="text-muted-foreground">
                            Administra quien tiene acceso al sistema.
                        </p>
                    </div>
                </div>
                <Link href="/maintenance/users/new">
                    <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">
                        <Plus className="mr-2 h-4 w-4" /> Crear Usuario
                    </Button>
                </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {users.map((user: any) => (
                    <Card key={user.id} className="dark:bg-slate-900 dark:border-slate-800">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                {user.name || user.username}
                            </CardTitle>
                            {user.role === 'ADMIN' ? (
                                <Shield className="h-4 w-4 text-indigo-500" />
                            ) : (
                                <User className="h-4 w-4 text-emerald-500" />
                            )}
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{user.username}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {user.email || 'Sin email'}
                            </p>
                            <div className="mt-4 flex items-center justify-between">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    }`}>
                                    {user.role === 'ADMIN' ? 'Administrador' : 'Cliente'}
                                </span>
                                {user.role === 'CLIENT' && user.client && (
                                    <span className="text-xs text-muted-foreground">
                                        Vinculado a: {user.client.name}
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
