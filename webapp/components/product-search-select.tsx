'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface Product {
  id: number;
  name: string;
  sku: string;
  lp1: number | null;
  last_purchase_cost: number | null;
  color_grade: string | null;
  last_sale_price: number | null;
}

interface ProductSearchSelectProps {
  products: Product[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export function ProductSearchSelect({
  products,
  value,
  onValueChange,
  placeholder = "Buscar producto..."
}: ProductSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter products based on search
  const filteredProducts = products.filter(product => {
    const searchLower = search.toLowerCase();
    return (
      product.sku.toLowerCase().includes(searchLower) ||
      product.name.toLowerCase().includes(searchLower) ||
      (product.color_grade && product.color_grade.toLowerCase().includes(searchLower))
    );
  }).slice(0, 50); // Limit to 50 results for performance

  // Get selected product for display
  const selectedProduct = products.find(p => p.id.toString() === value);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Clear search when closing
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearch('');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-8 bg-card hover:bg-accent text-sm"
        >
          <span className="truncate">
            {selectedProduct
              ? `${selectedProduct.sku} - ${selectedProduct.name}`
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[400px] p-0 bg-slate-900 border-slate-700" 
        align="start"
      >
        <div className="flex items-center border-b border-slate-700 bg-slate-900 p-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            placeholder="Escribe SKU o nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-slate-900 text-white placeholder:text-slate-400"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto bg-slate-900">
          {filteredProducts.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">
              No se encontraron productos
            </div>
          ) : (
            <div className="p-1">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    onValueChange(product.id.toString());
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors",
                    "hover:bg-emerald-600/20 hover:text-emerald-400",
                    value === product.id.toString()
                      ? "bg-emerald-600/30 text-emerald-300"
                      : "text-slate-200"
                  )}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === product.id.toString() ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col items-start flex-1 min-w-0">
                    <div className="flex items-center gap-2 w-full">
                      <span className="font-semibold text-emerald-400">
                        {product.sku}
                      </span>
                      {product.color_grade && (
                        <span className="text-xs text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                          {product.color_grade}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 truncate w-full">
                      {product.name}
                    </span>
                    {(product.lp1 || product.last_sale_price) && (
                      <span className="text-xs text-slate-500">
                        ${product.last_sale_price || product.lp1}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {filteredProducts.length > 0 && (
          <div className="border-t border-slate-700 p-2 bg-slate-900">
            <p className="text-xs text-slate-500 text-center">
              {filteredProducts.length === 50 
                ? "Mostrando primeros 50 resultados. Escribe para refinar..."
                : `${filteredProducts.length} producto${filteredProducts.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
