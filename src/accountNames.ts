import * as config from './util/config'
import * as fetch from 'node-fetch';
import * as scheduler from 'node-schedule';
import consoleStamp = require("console-stamp");
import * as fs from 'fs';
import { IssuerVerification } from './util/types';
import HttpsProxyAgent = require('https-proxy-agent');

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class AccountNames {

    private static _instance: AccountNames;

    private proxy = new HttpsProxyAgent(config.PROXY_URL);
    private useProxy = config.USE_PROXY;

    private bithompServiceNames:Map<string, IssuerVerification> = new Map();
    private xrpscanUserNames:Map<string, IssuerVerification> = new Map();
    private bithompUserNames:Map<string, IssuerVerification> = new Map();

    private constructor() { }

    public static get Instance(): AccountNames
    {
        // Do you need arguments? Make it a regular static method instead.
        return this._instance || (this._instance = new this());
    }

    public async init(): Promise<void> {
        scheduler.scheduleJob("reloadUserNames", {dayOfWeek: 1, hour: 12, minute: 0, second: 0}, () => this.resolveAllUserNames(true));
        await this.loadBithompUserNamesFromFS();
        await this.resolveAllUserNames();
    }

    public async resolveAllUserNames(deleteEmptyNames?: boolean): Promise<void> {
        try {
            //load bithomp services
            await this.loadBithompServiceNames();
            //load xrpscan services
            await this.loadXRPScanNames();

            if(deleteEmptyNames) {
                //reset all unkown accounts
                let iteratorMap: Map<string,IssuerVerification> = new Map(this.bithompUserNames);
                iteratorMap.forEach((value, key, map) => {
                    if(value == null || value.username == null || value.username.trim().length == 0)
                        this.bithompUserNames.delete(key);
                });
            }
        } catch(err) {
            console.log(err);
            console.log("some weird error happened!");
        }
        

    }

    public async loadBithompServiceNames() :Promise<void> {
        try {
            console.log("load service names from bithomp");
            let bithompResponse:any = await fetch.default("https://bithomp.com/api/v2/services/addresses", {headers: { "x-bithomp-token": config.BITHOMP_TOKEN }, agent: this.useProxy ? this.proxy : null})
            
            if(bithompResponse && bithompResponse.ok) {
                let knownServices:any = await bithompResponse.json();
                if(knownServices && knownServices.addresses) {
                    let addresses:any = knownServices.addresses;
                    let mainName:string = knownServices.name;
                    let domain:string = knownServices.domain;
                    let twitter:string = knownServices.socialAccounts && knownServices.socialAccounts.twitter;

                    for (var address in addresses) {
                        if (addresses.hasOwnProperty(address)) {
                            let name:string = addresses[address].name;
                            name = name ? name : mainName;
                            if(name) {
                                this.bithompServiceNames.set(address, {resolvedBy: "Bithomp", account: address, username: name, domain: domain, twitter: twitter, verified: true});
                            }
                        }
                    }
                }
            }

            console.log("bithomp service names: " + this.bithompServiceNames.size);
        } catch(err) {
            console.log("err retrieving addresse from bithomp");
            console.log(err);
        }
    }

    private async loadXRPScanNames() :Promise<void> {
        try {
            console.log("load xrpscan names");
            let xrpscanResponse:any = await fetch.default("https://api.xrpscan.com/api/v1/names/well-known", { agent: this.useProxy ? this.proxy : null})
            
            if(xrpscanResponse && xrpscanResponse.ok) {
                let knownServices:any[] = await xrpscanResponse.json();
                if(knownServices) {
                    for(let i = 0; i < knownServices.length; i++) {
                        let address:string = knownServices[i].account;
                        let name:string = knownServices[i].name;
                        let domain:string = knownServices[i].domain;
                        let twitter:string = knownServices[i].twitter;
                        let verified:boolean = knownServices[i].verified;

                        if(address && name && address.length > 0 && name.length > 0) {
                            this.xrpscanUserNames.set(address, {resolvedBy: "XRPScan", account: address, username: name, domain: domain, twitter: twitter, verified: verified});
                        }
                    }
                }
            }

            console.log("xrpscan names: " + this.xrpscanUserNames.size);
        } catch(err) {
            console.log("err retrieving addresse from xrpscan");
            console.log(err);
        }
    }

    private async loadBithompSingleAccountName(xrplAccount: string): Promise<void> {
        try {
            if(!this.bithompServiceNames.has(xrplAccount) && !this.xrpscanUserNames.has(xrplAccount) && !this.bithompUserNames.has(xrplAccount)) {
                console.log("resolving: " + xrplAccount);
                let bithompResponse:any = await fetch.default("https://bithomp.com/api/v2/address/"+xrplAccount+"?username=true&verifiedDomain=true", {headers: { "x-bithomp-token": config.BITHOMP_TOKEN }, agent: this.useProxy ? this.proxy : null})
                
                if(bithompResponse && bithompResponse.ok) {
                    let accountInfo:any = await bithompResponse.json();
            
                    console.log("resolved: " + JSON.stringify(accountInfo));
                    if(accountInfo) {
                        let username:string = accountInfo.username ? accountInfo.username : "";
                        let verifiedDomain:string = accountInfo.verifiedDomain;

                        this.bithompUserNames.set(xrplAccount, {resolvedBy: "Bithomp", account: xrplAccount, domain: verifiedDomain, verified: (verifiedDomain && verifiedDomain.trim().length > 0 ? true : false), username: username, twitter: null});
                    }

                    console.log("bithompUserNames size: " + this.bithompUserNames.size);
                }
            }
        } catch(err) {
            console.log("err retrieving single addresse from bithomp");
            console.log(err);
        }   
    }

    getUserName(xrplAccount:string): string {
        if(this.xrpscanUserNames.has(xrplAccount) && this.xrpscanUserNames.get(xrplAccount) != null && this.xrpscanUserNames.get(xrplAccount).username.trim().length > 0)
            return this.xrpscanUserNames.get(xrplAccount).username + "_[XRPScan]";

        else if(this.bithompServiceNames.has(xrplAccount) && this.bithompServiceNames.get(xrplAccount) != null && this.bithompServiceNames.get(xrplAccount).username.trim().length > 0)
            return this.bithompServiceNames.get(xrplAccount).username + "_[Bithomp]";
        
        else if(this.bithompUserNames.has(xrplAccount) && this.bithompUserNames.get(xrplAccount) != null && this.bithompUserNames.get(xrplAccount).username.trim().length > 0)
            return this.bithompUserNames.get(xrplAccount).username + "_[Bithomp]";

        else
            //try to resolve user name - seems like it is a new one!
            return null
    }

    getAccountData(xrplAccount:string): IssuerVerification {
        if(this.xrpscanUserNames.has(xrplAccount) && this.xrpscanUserNames.get(xrplAccount) != null)
            return this.xrpscanUserNames.get(xrplAccount);

        else if(this.bithompServiceNames.has(xrplAccount) && this.bithompServiceNames.get(xrplAccount) != null)
            return this.bithompServiceNames.get(xrplAccount);
        
        else if(this.bithompUserNames.has(xrplAccount) && this.bithompUserNames.get(xrplAccount) != null)
            return this.bithompUserNames.get(xrplAccount);

        else
            //try to resolve user name - seems like it is a new one!
            return null
    }

    async initAccountName(xrplAccount:string): Promise<void> {
        if(this.bithompServiceNames.has(xrplAccount)) {
            return;

        } else if(this.xrpscanUserNames.has(xrplAccount)) {
            return;
        
        } else if(this.bithompUserNames.has(xrplAccount)) {
            return;

        } else {
            //try to resolve user name - seems like it is a new one!
            this.loadBithompSingleAccountName(xrplAccount);
        }
    }

    public async saveBithompUserNamesToFS(): Promise<void> {
        if(this.bithompUserNames && this.bithompUserNames.size > 0) {
            let bithompNames:any = {};
            this.bithompUserNames.forEach((value, key, map) => {
                bithompNames[key] = value;
            });
            fs.writeFileSync("./../bithompUserNames.js", JSON.stringify(bithompNames));

            console.log("saved " + this.bithompUserNames.size + " user names to file system");
        }
    }

    private async loadBithompUserNamesFromFS(): Promise<void> {
        console.log("loading bithomp user names from FS");
        try {
            if(fs.existsSync("./../bithompUserNames.js")) {
                let bithompNames:any = JSON.parse(fs.readFileSync("./../bithompUserNames.js").toString());
                //console.log(JSON.stringify(bithompNames));
                if(bithompNames) {
                    for (var account in bithompNames) {
                        if (bithompNames.hasOwnProperty(account)) {
                            this.bithompUserNames.set(account, bithompNames[account] != null ? bithompNames[account] : "");
                        }
                    }

                    console.log("loaded " + this.bithompUserNames.size + " user names from file system");
                }
            } else {
                console.log("bithomp user name file does not exist yet.")
            }
        } catch(err) {
            console.log("error reading bithomp user names from FS");
            console.log(err);
            this.bithompUserNames.clear();
        }
    }
}