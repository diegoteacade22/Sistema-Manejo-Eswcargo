
import json
import os
from datetime import datetime

def parse_ledger_payments_only(file_path, client_id, after_date_str="01/14/2026"):
    """
    Parse only PAYMENTS (COBROS/PAGOS) after a specific date
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Parse cutoff date (MM/DD/YYYY)
    cutoff_parts = after_date_str.split('/')
    cutoff_date = datetime(int(cutoff_parts[2]), int(cutoff_parts[0]), int(cutoff_parts[1]))
    
    transactions = []
    
    for line in lines:
        if not line.strip(): continue
        parts = [p.strip() for p in line.split('\t')]
        if len(parts) < 4: continue
        
        date_str = parts[0]
        concept = parts[1]
        amount_raw = parts[-2]
        
        # Parse date
        try:
            date_parts = date_str.split('/')
            tx_date = datetime(int(date_parts[2]), int(date_parts[0]), int(date_parts[1]))
        except:
            continue
        
        # Skip if before cutoff
        if tx_date <= cutoff_date:
            continue
        
        # Clean amount
        amount_clean = amount_raw.replace('USD', '').replace(',', '').strip()
        try:
            amount = float(amount_clean)
        except:
            continue
        
        # Only process PAYMENTS
        concept_up = concept.upper()
        is_payment = any(x in concept_up for x in ['PAGÓ', 'PAGO', 'COBRO'])
        
        if not is_payment:
            continue
        
        # Determine payment method from description
        payment_method = None
        if 'USDT' in concept_up:
            payment_method = 'USDT'
        elif 'BILLETE' in concept_up or 'EFECTIVO' in concept_up:
            payment_method = 'EFECTIVO'
        elif 'ZELLE' in concept_up:
            payment_method = 'ZELLE'
        
        transactions.append({
            "clientId": client_id,
            "date": date_str,
            "type": "PAGO",
            "amount": amount,
            "description": concept,
            "reference": f"Manual-Pago-{date_str.replace('/', '')}-{int(amount)}",
            "paymentMethod": payment_method
        })
    
    return transactions

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Parse only payments after 01/14/2026
    data = parse_ledger_payments_only(
        os.path.join(base_dir, "162_raw.txt"), 
        162,
        after_date_str="01/14/2026"
    )
    
    # Save to new file
    with open(os.path.join(base_dir, "162_payments_only.json"), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Parseados {len(data)} PAGOS posteriores al 14/01/2026")
    
    # Show summary
    total = sum(p['amount'] for p in data)
    print(f"💰 Total de pagos: ${total:,.2f}")
    
    if data:
        print(f"\n📋 Primeros 3 pagos:")
        for p in data[:3]:
            print(f"  {p['date']} - ${p['amount']:,.2f} - {p['description']}")
