# Finance

- Use integer cents for every amount. Never infer an account from a daily expense unless the user explicitly names one.
- The three finance databases are separate: expenses, incomes and account entries. Account entries record deposits or withdrawals and are not daily spending.
- Use `finance_taxonomy` for the current major/minor labels and `finance_quick_preview` before converting natural language into a ledger entry.
- Check date, amount, category and account before a write. Use the date in the user's local timezone.
- Use `finance_expenses_list`, `finance_incomes_list`, `finance_account_entries_list` and `finance_summary` for verification after a write.
