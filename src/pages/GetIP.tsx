import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSupportSettings } from '@/hooks/useSupportSettings';

export default function GetIP() {
  const [loading, setLoading] = useState(false);
  const [ips, setIps] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const support = useSupportSettings();
  const supportUrl = support.whatsappUrl || support.telegramUrl || '';

  const getIPs = async () => {
    setLoading(true);
    const detectedIPs = new Set<string>();
    
    try {
      // Call many more times to get all possible IPs
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase.functions.invoke('get-my-ip', {
          body: {},
        });

        if (error) throw error;

        if (data.success) {
          detectedIPs.add(data.ip);
        }
        
        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const ipArray = Array.from(detectedIPs);
      setIps(ipArray);
      
      toast({
        title: "IPs Detected!",
        description: `Found ${ipArray.length} unique IP(s) from 50 requests`,
      });
    } catch (error: any) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to get IPs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyIPs = () => {
    const ipList = ips.join(', ');
    navigator.clipboard.writeText(ipList);
    setCopied(true);
    toast({
      title: "Copied!",
      description: "IP addresses copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Get Supabase IP Addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Click the button below to detect your Supabase Edge Function IP addresses.
            We'll call the function 50 times to discover all possible IPs from the load balancer.
          </p>

          <Button 
            onClick={getIPs} 
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Detecting IPs... (50 requests)
              </>
            ) : (
              "Get All IP Addresses"
            )}
          </Button>

          {ips.length > 0 && (
            <Card className="bg-muted">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">Found {ips.length} unique IP(s):</p>
                  <Button 
                    onClick={copyIPs}
                    variant="outline"
                    size="sm"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy All
                      </>
                    )}
                  </Button>
                </div>
                <div className="space-y-1">
                  {ips.map((ip, index) => (
                    <p key={index} className="text-lg font-mono font-bold">
                      {ip}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {ips.length > 0 && (
            <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950">
              <h3 className="font-semibold mb-2">Next Steps:</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Copy all IP addresses above (comma-separated)</li>
                <li>
                  {supportUrl ? (
                    <>Message support at{' '}
                    <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      this link
                    </a></>
                  ) : (
                    'Message support via the Support Center'
                  )}
                </li>
                <li>Request help adding these IPs to your SageCloud whitelist</li>
                <li>Format: {ips.join(', ')}</li>
                <li>Once whitelisted, data plans and purchases will work!</li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
