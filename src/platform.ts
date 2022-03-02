import axios from 'axios';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Thermostat } from './platformAccessory';

/**
* HomebridgePlatform
* This class is the main constructor for your plugin, this is where you should
* parse the user config and discover/register accessories with Homebridge.
*/
export class NestPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.debug('Finished initializing platform:', this.config.platform);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });
    }

    /**
    * This function is invoked when homebridge restores cached accessories from disk at startup.
    * It should be used to setup event handlers for characteristics and update respective values.
    */
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);

        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
    * This is an example method showing how to register discovered accessories.
    * Accessories must only be registered once, previously created accessories
    * must not be registered again to prevent "duplicate UUID" errors.
    */
    getAccessToken = async () => {
        return new Promise(async (resolve, reject) => {
            try {
                const now = new Date().getTime();
                if(this.config.access && this.config.access.expiration > now) {
                    this.log.info(`using cached token, expires in ${this.parseDuration((this.config.access.expiration - now) / 1000)}`)
                    resolve(this.config.access.token);
                    return;
                }

                this.log.info('requesting new token...');
                const { data } = await axios.post('https://www.googleapis.com/oauth2/v4/token', {
                    client_id: this.config.client_id,
                    client_secret: this.config.client_secret,
                    refresh_token: this.config.refresh_token,
                    grant_type: 'refresh_token'
                });

                // tokens expire after 60 minutes
                // use 55 minutes for expiration date to allow a bit of a buffer
                this.config.access = {
                    expiration: new Date().getTime() + (55 * 60000),
                    token: data.access_token
                }
                resolve(data.access_token);

            } catch(e) {
                reject(e);
                this.log.error(`Unable to connect to Nest service. ${e.response.data.message || e.response.data.error_description || 'An unknown error occurred'}`);
            }
        })
    }

    discoverDevices = async () =>  {
        try {

            const token = await this.getAccessToken();
            this.log.info('Nest account authenticated: ', token);

            // loop over the discovered devices and register each one if it has not already been registered
            for(const device of this.config.thermostats) {

                // generate a unique id for the accessory this should be generated from
                // something globally unique, but constant, for example, the device serial
                // number or MAC address
                const uuid = this.api.hap.uuid.generate(device.device_id);

                // see if an accessory with the same uuid has already been registered and restored from
                // the cached devices we stored in the `configureAccessory` method above
                const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
                if(existingAccessory) {
                    // the accessory already exists
                    this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

                    // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                    // existingAccessory.context.device = device;
                    // this.api.updatePlatformAccessories([existingAccessory]);

                    // create the accessory handler for the restored accessory
                    // this is imported from `platformAccessory.ts`
                    new Thermostat(this, existingAccessory);

                    // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
                    // remove platform accessories when no longer present
                    // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                    // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
                } else {
                    // the accessory does not yet exist, so we need to create it
                    this.log.info('Adding new accessory:', device.name);

                    // create a new accessory
                    const accessory = new this.api.platformAccessory(device.name, uuid);

                    // store a copy of the device object in the `accessory.context`
                    // the `context` property can be used to store any data about the accessory you may need
                    accessory.context.device = device;

                    // create the accessory handler for the newly create accessory
                    // this is imported from `platformAccessory.ts`
                    new Thermostat(this, accessory);

                    // link the accessory to your platform
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                }
            }

        } catch(e) {
            this.log.error(`Unable to connect to Nest service. ${e.response.data.message || e.response.data.error_description || 'An unknown error occurred'}`);
        }
    }

    parseDuration = duration => {
        const d = parseInt(duration);
        const h = Math.floor(d / 3600);
        const m = Math.floor(d % 3600 / 60);
        const s = Math.floor(d % 3600 % 60);

        const hours = h > 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : null;
        const minutes = m > 0 ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : null;
        if(hours && minutes && s) {
            return `${hours}, ${minutes}, and ${s} seconds`;
        } else if(hours && minutes) {
            return `${hours} and ${minutes}`;
        } else if(m > 1) {
            return minutes;
        } else if(h > 0) {
            return hours;
        }
        return `${s} seconds`;
    }
}
