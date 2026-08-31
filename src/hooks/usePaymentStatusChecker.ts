import { useEffect, useRef } from 'react';
import { verifyAndCreditWalletSecure, checkTransactionByReference } from '@/lib/supabase';
import { useAuth } from '@/contexts/SimpleAuth';
import { useToast } from '@/hooks/use-toast';

// Ercas Pay has a server-side "verify and credit" edge function the client can call
// directly. PocketFi credits the wallet via webhook-pocketfi instead, so
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
  const { user, refreshWalletBalance, showBalances } = useAuth();
  const { toast } = useToast();
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Stricter lock using useRef instead of global variables
  const isCheckingRef = useRef(false);
  const processingTransactionsRef = useRef(new Set<string>());

  useEffect(() => {
    const checkPendingPayments = async () => {
      // Stricter lock to prevent multiple simultaneous checks
      if (isCheckingRef.current) {
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

        // Check if already processing this transaction
        if (processingTransactionsRef.current.has(transactionRef)) {
          return;
        }
        
        // Check if this transaction was already processed
        const processedTransactions = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
        if (processedTransactions.includes(transactionRef)) {
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
        
        if (result.success) {
          // Payment successful and wallet credited
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
              : showBalances
                ? `₦${result.amount?.toLocaleString()} has been added to your wallet.`
                : `Your wallet has been updated.`,
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
  }, [user, refreshWalletBalance, showBalances, toast]);

  // Also check when window gets focus (user returns from payment tab)
  useEffect(() => {
    const handleFocus = () => {
      const pendingTopup = localStorage.getItem('pending_topup');
      if (pendingTopup && user?.id) {
        // Check immediately when user returns
        setTimeout(async () => {
          // Check lock first
          if (isCheckingRef.current) {
            return;
          }

          try {
            const transaction = JSON.parse(pendingTopup);
            const transactionRef = transaction.transactionReference;
            
            // Check if already processing this transaction
            if (processingTransactionsRef.current.has(transactionRef)) {
              return;
            }
            
            // Check if this transaction was already processed
            const processedTransactions = JSON.parse(localStorage.getItem('processed_transactions') || '[]');
            if (processedTransactions.includes(transactionRef)) {
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
            
            if (result.success) {
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
                  : showBalances
                    ? `₦${result.amount?.toLocaleString()} has been added to your wallet.`
                    : `Your wallet has been updated.`,
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
  }, [user, refreshWalletBalance, showBalances, toast]);
}
