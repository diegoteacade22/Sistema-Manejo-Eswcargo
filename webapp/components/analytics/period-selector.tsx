
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PeriodSelectorProps {
    value: number;
    onChange: (value: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
    return (
        <Select value={value.toString()} onValueChange={(val) => onChange(parseInt(val))}>
            <SelectTrigger className="w-[180px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800">
                <SelectValue placeholder="Seleccionar periodo" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="6">Últimos 6 Meses</SelectItem>
                <SelectItem value="12">Últimos 12 Meses</SelectItem>
                <SelectItem value="18">Últimos 18 Meses</SelectItem>
                <SelectItem value="24">Últimos 2 Años</SelectItem>
                <SelectItem value="36">Últimos 3 Años</SelectItem>
                <SelectItem value="48">Últimos 4 Años</SelectItem>
                <SelectItem value="60">Histórico (5 Años)</SelectItem>
            </SelectContent>
        </Select>
    );
}
