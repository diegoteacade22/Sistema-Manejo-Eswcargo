
import json

with open('webapp/prisma/orders_seed.json') as f:
    orders = json.load(f)

total_debt = 0
total_payments = 0
unpaid_count = 0

print(f"Total Orders: {len(orders)}")

for o in orders:
    debt = o.get('total_amount', 0)
    pay = o.get('payment_amount', 0)
    
    total_debt += debt
    total_payments += pay
    
    if debt > 0 and pay == 0:
        unpaid_count += 1
        # Print first few unpaid high value orders
        if debt > 1000:
            print(f"Unpaid High Value Order: #{o['order_number']} - ${debt} (Client Old ID: {o.get('client_old_id')})")

print(f"Total Debt (Sum of Totals): {total_debt:,.2f}")
print(f"Total Payments (Sum of Payments): {total_payments:,.2f}")
print(f"Net System Balance (Should be close to 0 if all paid): {total_debt - total_payments:,.2f}")
print(f"Count of completely unpaid orders: {unpaid_count}")
