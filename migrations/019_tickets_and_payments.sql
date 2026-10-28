-- Tickets instead of inventory: every room and day immersion is sold as tickets to the retreat.
-- A room has one ticket per guest (its guest capacity); a day immersion can have an optional ticket limit.
-- Guests pay on the outside payment site; each sale and each payment toward it is recorded here in the admin.

CREATE TABLE IF NOT EXISTS ticket_sales (
  id           text PRIMARY KEY,
  retreat_id   text NOT NULL REFERENCES retreats(id),
  option_id    text NOT NULL,                 -- a room_types id or a day immersion id
  option_name  text NOT NULL,                 -- the name as sold
  guest_name   text NOT NULL,
  guest_email  text,
  guest_phone  text,
  plan         text NOT NULL CHECK (plan IN ('deposit','full')),
  total_cents  int NOT NULL CHECK (total_cents >= 0),   -- the ticket price as sold
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
  notes        text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_sales_option ON ticket_sales(retreat_id, option_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ticket_payments (
  id           text PRIMARY KEY,
  sale_id      text NOT NULL REFERENCES ticket_sales(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  paid_on      date NOT NULL DEFAULT current_date,
  note         text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_payments_sale ON ticket_payments(sale_id);
