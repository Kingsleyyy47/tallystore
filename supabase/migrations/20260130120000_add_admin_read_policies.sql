-- Add admin read access to profiles and orders tables for admin dashboard
-- This allows admins to view all users and sales statistics

-- Profiles: Allow admin to read all profiles
CREATE POLICY "Admin can read all profiles"
ON profiles FOR SELECT
TO authenticated
USING (
  -- Check if the requesting user is an admin (by checking their own profile)
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  )
  OR
  -- Or if user is viewing their own profile
  auth.uid() = id
);

-- Drop existing select policy if it's too restrictive
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;

-- Orders: Allow admin to read all orders
DO $$
BEGIN
  -- Check if policy exists before creating
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'orders' AND policyname = 'Admin can read all orders'
  ) THEN
    CREATE POLICY "Admin can read all orders"
    ON orders FOR SELECT
    TO authenticated
    USING (
      -- Admin can see all orders
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      -- Users can see their own orders
      auth.uid() = user_id
    );
  END IF;
END $$;

-- Drop existing select policy on orders if too restrictive
DROP POLICY IF EXISTS "Users can read own orders" ON orders;

-- Transactions: Allow admin to read all transactions for user management
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'transactions' AND policyname = 'Admin can read all transactions'
  ) THEN
    CREATE POLICY "Admin can read all transactions"
    ON transactions FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      auth.uid() = user_id
    );
  END IF;
END $$;

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Users can read own transactions" ON transactions;
