import { useEffect, useRef } from 'react';
import { verifyAndCreditWalletSecure, checkTransactionByReference } from '@/lib/supabase';
import { useAuth } from '@/contexts/SimpleAuth';
import { useToast } from '@/hooks/use-toast';

// Ercas Pay has a server-side "verify and credit" edge function the client can call
// directly. PocketFi credits the wallet via webhook (api/webhook-pocketfi.ts) instead, so
// for PocketFi we just poll the transactions table to see if that webhook has landed yet.
async function checkPocketFiTransaction(transactionRef: string) {
  const result = await checkTransactionByReference(transactionRef)
  if (result.found && result.status === 'completed') {
    return { success: true, amount: result.amount, already_processed: false }
  }
  if (result.found) {
    return { success: false, error: result.status || 'failed' }
  }
  return { success: false, error: 'PENDING' }
}

export function usePaymentStatusChecker() {
  const { user, refreshWalletBalance } = useAuth();
  const { toast } = useToast();
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Stricter lock using useRef instead of global variables
  const isCheckingRef = useRef(false);
  const processingTransactionsRef = useRef(new Set<string>());

  useEffect(() => {
    const checkPendingPayments = async () => {
      // Stricter lock to prevent multiple simultaneous checks
      if (isCheckingRef.current) {
        console.log('🚫 Another transaction is being processed, skipping check');
        return;
      }

      const pendingTopup = localStorage.getItem('pending_topup');
      
      if (!pendingTopup || !user?.id) return;

      try {
        const transaction = JSON.parse(pendingTopup);
        const timeSinceInitiation = Date.now() - transaction.timestamp;
        const transactionRef = transaction.transactionReference;
        
        // Stop checking after 30 minutes
        if (timeSinceInitiation > 30 * 60 * 1000) {
          localStorage.removeItem('pending_topup');
          return;
        }

        console.log('🔍 Checking payment status:', transactionRef);
        
        // Check if already processing this transaction
        if (processingTransactionsRef.current.has(transactionRef)) {
          console.log('⏳ Transaction already being processed, skipping:', transactionRef);
          return;
        }
        
        // Check if this transaction was already processed
        const processedTransactions = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
        if (processedTransactions.includes(transactionRef)) {
          console.log('✅ Transaction already processed, cleaning up:', transactionRef);
          localStorage.removeItem('pending_topup');
          return;
        }
        
        // Mark as processing
        processingTransactionsRef.current.add(transactionRef);
        isCheckingRef.current = true;
        
        // Use the right verification path for the gateway this top-up was started with
        const result = transaction.gateway === 'pocketfi'
          ? await checkPocketFiTransaction(transactionRef)
          : await verifyAndCreditWalletSecure(transactionRef);
        console.log('📊 Verification result:', result);
        
        if (result.success) {
          // Payment successful and wallet credited
          console.log('💰 Payment verified and wallet credited:', result.amount);
          
          await refreshWalletBalance();
          
          // Mark transaction as processed
          const processedTransactions = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
          processedTransactions.push(transactionRef);
          localStorage.setItem('processed_transactions', JSON.stringify(processedTransactions));
          
          localStorage.removeItem('pending_topup');
          
          toast({
            title: result.already_processed ? "Payment Already Processed! ✅" : "Payment Successful! 🎉",
            description: result.already_processed 
              ? `Your wallet balance is up to date.`
              : `₦${result.amount?.toLocaleString()} has been added to your wallet.`,
          });
          
          // Notify UI to reload transactions
          window.dispatchEvent(new CustomEvent('transactionAdded'));
          
          // Stop checking
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
          }
        } else if (result.error?.includes('PENDING') || result.error?.includes('pending')) {
          // Still pending - keep checking
          console.log('⏳ Payment still pending...');
        } else {
          // Payment failed - clean up
          localStorage.removeItem('pending_topup');
          
          toast({
            title: "Payment Failed",
            description: "Your payment was not successful. Please try again.",
            variant: "destructive",
          });
          
          // Stop checking
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
          }
        }
        // If status is 'pending', continue checking
        
      } catch (error) {
        console.error('Error checking payment status:', error);
      } finally {
        // Remove from processing set if we have the reference
        const pendingTopupData = localStorage.getItem('pending_topup');
        if (pendingTopupData) {
          try {
            const transaction = JSON.parse(pendingTopupData);
            processingTransactionsRef.current.delete(transaction.transactionReference);
          } catch (e) {
            // Ignore parsing errors in finally block
          }
        }
        // Release lock
        isCheckingRef.current = false;
      }
    };

    // Check immediately on mount
    checkPendingPayments();

    // Set up interval to check every 10 seconds
    checkIntervalRef.current = setInterval(checkPendingPayments, 10000);

    // Cleanup interval on unmount
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [user, refreshWalletBalance, toast]);

  // Also check when window gets focus (user returns from payment tab)
  useEffect(() => {
    const handleFocus = () => {
      const pendingTopup = localStorage.getItem('pending_topup');
      if (pendingTopup && user?.id) {
        // Check immediately when user returns
        setTimeout(async () => {
          // Check lock first
          if (isCheckingRef.current) {
            console.log('🚫 Another transaction is being processed, skipping focus check');
            return;
          }

          try {
            const transaction = JSON.parse(pendingTopup);
            const transactionRef = transaction.transactionReference;
            
            console.log('🔎 Checking payment on window focus:', transactionRef);
            
            // Check if already processing this transaction
            if (processingTransactionsRef.current.has(transactionRef)) {
              console.log('⏳ Transaction already being processed on focus, skipping:', transactionRef);
              return;
            }
            
            // Check if this transaction was already processed
            const processedTransactions = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
            if (processedTransactions.includes(transactionRef)) {
              console.log('✅ Transaction already processed on focus, cleaning up:', transactionRef);
              localStorage.removeItem('pending_topup');
              return;
            }
            
            // Mark as processing
            processingTransactionsRef.current.add(transactionRef);
            isCheckingRef.current = true;
            
            // Use the right verification path for the gateway this top-up was started with
            const result = transaction.gateway === 'pocketfi'
              ? await checkPocketFiTransaction(transactionRef)
              : await verifyAndCreditWalletSecure(transactionRef);
            console.log('📋 Focus verification result:', result);
            
            if (result.success) {
              console.log('💰 Focus check: Payment verified and wallet credited:', result.amount);
              
              await refreshWalletBalance();
              
              // Mark transaction as processed
              const processedTxs = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
              processedTxs.push(transactionRef);
              localStorage.setItem('processed_transactions', JSON.stringify(processedTxs));
              
              localStorage.removeItem('pending_topup');
              
              toast({
                title: result.already_processed ? "Payment Already Processed! ✅" : "Payment Successful! 🎉",
                description: result.already_processed 
                  ? `Your wallet balance is up to date.`
                  : `₦${result.amount?.toLocaleString()} has been added to your wallet.`,
              });
              
              // Notify UI to reload transactions
              window.dispatchEvent(new CustomEvent('transactionAdded'));
            }
            
            // Remove from processing set
            processingTransactionsRef.current.delete(transactionRef);
            isCheckingRef.current = false;
          } catch (error) {
            console.error('Error checking payment on focus:', error);
            // Release lock on error
            isCheckingRef.current = false;
          }
        }, 1000);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user, refreshWalletBalance, toast]);
}
