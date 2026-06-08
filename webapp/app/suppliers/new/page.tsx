
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

async function createSupplier(formData: FormData) {
    'use server';

    const name = formData.get('name') as string;
    const contact = formData.get('contact') as string;
    const email = formData.get('email') as string;
    const phone = formData.get('phone') as string;

    if (!name) return;

    await prisma.supplier.create({
        data: {
            name,
            contact,
            email,
            phone
        }
    });

    redirect('/suppliers');
}

export default function NewSupplierPage() {
    return (
        <div className="p-8 space-y-8 max-w-2xl mx-auto">
            <div className="flex items-center space-x-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/suppliers"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Nuevo Proveedor</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Datos del Proveedor</CardTitle>
                </CardHeader>
                <CardContent>
                    <form action={createSupplier} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Nombre / Razón Social</Label>
                            <Input id="name" name="name" required placeholder="Ej: Best Buy, Apple, etc." />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="contact">Nombre de Contacto</Label>
                            <Input id="contact" name="contact" placeholder="Ej: Juan Pérez" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="email">Email</Label>
                                <Input id="email" name="email" type="email" placeholder="contacto@empresa.com" />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="phone">Teléfono / WhatsApp</Label>
                                <Input id="phone" name="phone" placeholder="+1 555-0199" />
                            </div>
                        </div>

                        <div className="pt-4 flex justify-end">
                            <Button type="submit" className="bg-orange-600 hover:bg-orange-700 text-white">
                                Guardar Proveedor
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
