
import DynamoDB = require('aws-sdk/clients/dynamodb');
import { DynamoItemOptions, ProvisionedThroughput, DynamoItemIndex } from './options';
import { createTableInput } from 'dynamo-input';
import { delay } from './helpers';

export type ItemKey = { [key: string]: number | string }
export type ItemType = object

export interface ItemUpdateData<T extends ItemType> {
    key: ItemKey
    set?: Partial<T>
    remove?: (keyof T)[]
}

export class BaseDynamoItem<T extends ItemType> {
    protected service: DynamoDB
    protected tableName: () => string
    private indexHash: { [key: string]: DynamoItemIndex } = {}

    constructor(protected options: DynamoItemOptions, protected client: DynamoDB.DocumentClient) {
        this.service = (<any>client).service;

        if (!this.service) {
            throw new Error(`Invaild DynamoDB version`);
        }

        if (typeof options.tableName === 'function') {
            this.tableName = options.tableName;
        } else {
            this.tableName = () => options.tableName as string;
        }

        if (options.indexes) {
            for (const index of options.indexes) {
                this.indexHash[index.name] = index;
            }
        }
    }

    async createTable(throughput?: ProvisionedThroughput) {

        const options = this.options;
        const name = this.tableName();

        const input = createTableInput({
            name,
            hashKey: options.hashKey,
            rangeKey: options.rangeKey,
            throughput: throughput,
            indexes: options.indexes,
        });

        try {
            await this.service.createTable(input).promise();
        } catch (e) {
            // resource exists
            if (e.code === 'ResourceInUseException') {
                return;
            }
            throw e;
        }

        while (true) {
            const status = await this.service.describeTable({ TableName: name }).promise();
            if (!status.Table || !status.Table.TableStatus) {
                throw new Error(`Table ${name} not found!`);
            }
            if (status.Table.TableStatus === 'CREATING') {
                await delay(1000);
            } else {
                return;
            }
        }
    }

    async deleteTable() {
        const name = this.tableName();

        await this.service.deleteTable({
            TableName: name,
        }).promise();

        while (true) {
            try {
                const status = await this.service.describeTable({ TableName: name }).promise();
                if (!status.Table || !status.Table.TableStatus) {
                    throw new Error(`Table ${name} not found!`);
                }
                if (status.Table.TableStatus === 'DELETING') {
                    await delay(1000);
                } else {
                    return;
                }
            } catch (e) {
                return;
            }
        }
    }

    protected beforeCreate(data: T): T {
        return data;
    }

    protected beforeUpdate(data: ItemUpdateData<T>): ItemUpdateData<T> {
        return data;
    }

    protected formatKeyFromData(data: any): ItemKey {
        const key: ItemKey = {};

        const hashKey = this.options.hashKey;
        key[hashKey.name] = data[hashKey.name];

        const rangeKey = this.options.rangeKey;
        if (rangeKey) {
            key[rangeKey.name] = data[rangeKey.name];
        }

        return key;
    }

    protected getHashKeyName(indexName?: string) {
        if (!indexName) {
            return this.options.hashKey.name;
        }
        const index = this.indexHash[indexName];
        if (!index) {
            throw new Error(`Not found an index with name=${indexName}`);
        }

        return index.hashKey.name;
    }

    protected getRangeKeyName(indexName?: string) {
        if (!indexName) {
            if (!this.options.rangeKey) {
                throw new Error(`Table ${this.options.name} has no range key!`);
            }
            return this.options.rangeKey.name;
        }
        const index = this.indexHash[indexName];
        if (!index) {
            throw new Error(`Not found an index with name=${indexName}`);
        }

        if (!index.rangeKey) {
            throw new Error(`Index ${indexName} has no range key!`);
        }

        return index.rangeKey.name;
    }
}
