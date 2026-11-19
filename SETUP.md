# Turning on the shared database (5 minutes, free)

1. (Done for this project: supabase.com project "landlog".) To redo elsewhere: create a project at supabase.com.
2. Open **SQL Editor**, paste all of `supabase.sql`, press **Run**.
3. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key into `config.js`.
4. Commit and push. The live site now shares reviews and landlord names between everyone.

Moderation: open **Table Editor > reviews**. Set `hidden` to true to remove a review, false to restore one. Three reports hide a review automatically. Add a landlord's reply in the `reply` column.
