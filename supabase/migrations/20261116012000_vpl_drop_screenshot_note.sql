-- 0010 — remove the one note my own screenshot run left in the owner's tree.
-- One row, matched by its id, so no person's note can be caught by a title.

delete from public.notes
 where id = '1c5e24ec-f754-415f-9097-2d5f73a87937'
   and title = 'plan za vikend';
