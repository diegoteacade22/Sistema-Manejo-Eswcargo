
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

interface Props {
    params: Promise<{ id: string }>;
}

async function getSupplier(id: string) {
    const supplierId = parseInt(id);
    if (isNaN(supplierId)) return null;

    return await (prisma as any).supplier.findUnique({
        where: { id: supplierId }
    });
}

export default async function SupplierDetailPage(props: Props) {
    const params = await props.params;
    const supplier = await getSupplier(params.id);

    if (!supplier) {
        return (
            <div className="p-8">
                <div className="bg-red-50 text-red-600 p-4 rounded-lg">
                    Proveedor no encontrado
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Button variant="outline" size="icon" asChild>
                        <Link href="/suppliers"><ArrowLeft className="h-4 w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">{supplier.name}</h1>
                        <p className="text-muted-foreground">ID: #{supplier.id}</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Contact Info */}
                <Card>
                    <CardHeader>
                        <CardTitle>Información de Contacto</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center space-x-3">
                            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                                <span className="text-lg font-bold text-slate-600">{supplier.name.charAt(0)}</span>
                            </div>
                            <div>
                                <p className="font-medium text-lg">{supplier.contact || 'Sin contacto'}</p>
                                <p className="text-sm text-muted-foreground">Contacto Principal</p>
                            </div>
                        </div>

                        <div className="pt-4 space-y-3">
                            <div className="flex items-center text-sm">
                                <Mail className="mr-2 h-4 w-4 text-slate-400" />
                                <span>{supplier.email || 'No registrado'}</span>
                            </div>
                            <div className="flex items-center text-sm">
                                <Phone className="mr-2 h-4 w-4 text-slate-400" />
                                <span>{supplier.phone || 'No registrado'}</span>
                            </div>
                            <div className="flex items-center text-sm">
                                <MapPin className="mr-2 h-4 w-4 text-slate-400" />
                                <span>{supplier.address || 'No registrado'}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Additional Details */}
                <Card>
                    <CardHeader>
                        <CardTitle>Notas y Observaciones</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {supplier.notes ? (
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{supplier.notes}</p>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">Sin notas adicionales.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
