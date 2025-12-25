'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { createUser } from '@/app/user-actions';
import { useRouter } from 'next/navigation';

interface Client {
    id: number;
    name: string;
    userId?: string | null;
}

interface UserFormProps {
    clients: Client[];
}

export function UserForm({ clients }: UserFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        username: '',
        email: '',
        password: '',
        role: 'CLIENT',
        clientId: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleRoleChange = (value: string) => {
        setFormData({ ...formData, role: value });
    };

    const handleClientChange = (value: string) => {
        setFormData({ ...formData, clientId: value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            const res = await createUser(formData);
            if (res.success) {
                setMessage({ text: 'Usuario creado exitosamente', type: 'success' });
                setTimeout(() => router.push('/maintenance/users'), 1500);
            } else {
                setMessage({ text: res.message || 'Error al crear usuario', type: 'error' });
            }
        } catch (error) {
            setMessage({ text: 'Ocurrió un error inesperado', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-lg mx-auto dark:bg-slate-900 dark:border-slate-800">
            <CardHeader>
                <CardTitle>Crear Nuevo Usuario</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {message && (
                        <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {message.text}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="name">Nombre Completo</Label>
                        <Input id="name" name="name" placeholder="Ej. Juan Pérez" value={formData.name} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="username">Usuario (Login)</Label>
                        <Input id="username" name="username" placeholder="juanperez" value={formData.username} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" placeholder="usuario@email.com" value={formData.email} onChange={handleChange} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Contraseña</Label>
                        <Input id="password" name="password" type="password" placeholder="********" value={formData.password} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="role">Rol</Label>
                        <Select onValueChange={handleRoleChange} defaultValue={formData.role}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar Rol" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CLIENT">Cliente</SelectItem>
                                <SelectItem value="ADMIN">Administrador</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.role === 'CLIENT' && (
                        <div className="space-y-2">
                            <Label htmlFor="clientId">Vincular a Cliente</Label>
                            <Select onValueChange={handleClientChange} value={formData.clientId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar Cliente del Sistema" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id.toString()}>
                                            {client.name} {client.userId ? '(Ya tiene usuario)' : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Permite que este usuario vea la información de este cliente.
                            </p>
                        </div>
                    )}

                    <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                        {loading ? 'Creando...' : 'Crear Usuario'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
