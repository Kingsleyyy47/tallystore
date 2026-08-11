import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle, 
  Bell,
  RefreshCw,
  X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface AdminAlert {
  id: string;
  created_at: string;
  alert_type: 'low_balance' | 'critical_balance' | 'insufficient_balance' | 'system_error' | 'security';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  context: {
    balance_info?: {
      currentBalance: number;
      requestedAmount: number;
      shortfall: number;
      isLowBalance: boolean;
      isCriticalBalance: boolean;
    };
    thresholds?: {
      LOW_BALANCE_THRESHOLD: number;
      CRITICAL_BALANCE_THRESHOLD: number;
    };
    transaction_type?: string;
    user_id?: string;
  };
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setAlerts(data || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch alerts',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('admin_alerts')
        .update({ 
          acknowledged: true, 
          acknowledged_at: new Date().toISOString() 
        })
        .eq('id', alertId);

      if (error) throw error;
      
      setAlerts(prev => 
        prev.map(a => 
          a.id === alertId 
            ? { ...a, acknowledged: true, acknowledged_at: new Date().toISOString() } 
            : a
        )
      );
      
      toast({
        title: 'Alert Acknowledged',
        description: 'Alert has been marked as acknowledged',
      });
    } catch (error) {
      console.error('Error acknowledging alert:', error);
      toast({
        title: 'Error',
        description: 'Failed to acknowledge alert',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchAlerts();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('admin_alerts_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_alerts' },
        (payload) => {
          setAlerts(prev => [payload.new as AdminAlert, ...prev]);
          toast({
            title: '🚨 New Alert',
            description: (payload.new as AdminAlert).message,
            variant: 'destructive',
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default:
        return <Bell className="h-5 w-5 text-blue-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, string> = {
      critical: 'bg-red-500 text-white',
      error: 'bg-red-400 text-white',
      warning: 'bg-yellow-500 text-black',
      info: 'bg-blue-500 text-white',
    };
    return (
      <Badge className={variants[severity] || variants.info}>
        {severity.toUpperCase()}
      </Badge>
    );
  };

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle>System Alerts</CardTitle>
          {unacknowledgedCount > 0 && (
            <Badge variant="destructive">{unacknowledgedCount} new</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={fetchAlerts} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading && alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p>No alerts - all systems operational</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-4 rounded-lg border ${
                  alert.acknowledged 
                    ? 'bg-muted/30 border-muted' 
                    : alert.severity === 'critical' 
                    ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                    : alert.severity === 'warning'
                    ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800'
                    : 'bg-background border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    {getSeverityIcon(alert.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityBadge(alert.severity)}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(alert.created_at), 'MMM d, yyyy HH:mm')}
                        </span>
                        {alert.acknowledged && (
                          <Badge variant="outline" className="text-xs">
                            Acknowledged
                          </Badge>
                        )}
                      </div>
                      <p className={`text-sm ${alert.acknowledged ? 'text-muted-foreground' : 'font-medium'}`}>
                        {alert.message}
                      </p>
                      {alert.context?.balance_info && (
                        <div className="mt-2 text-xs text-muted-foreground space-y-1">
                          <p>💰 Current Balance: ₦{alert.context.balance_info.currentBalance.toLocaleString()}</p>
                          {alert.context.balance_info.requestedAmount > 0 && (
                            <p>📤 Requested: ₦{alert.context.balance_info.requestedAmount.toLocaleString()}</p>
                          )}
                          {alert.context.balance_info.shortfall > 0 && (
                            <p>⚠️ Shortfall: ₦{alert.context.balance_info.shortfall.toLocaleString()}</p>
                          )}
                          <p>📋 Transaction: {alert.context.transaction_type || 'N/A'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {!alert.acknowledged && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
