//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Client as MinioClient } from 'minio'
import { Class, Doc, DocumentQuery, DOMAIN_MODEL, DOMAIN_TX, FindOptions, FindResult, Hierarchy, ModelDb, Ref, Tx, TxResult } from '@anticrm/core'
import { createElasticAdapter } from '@anticrm/elastic'
import { createMongoAdapter, createMongoTxAdapter } from '@anticrm/mongo'
import type { DbAdapter, DbConfiguration } from '@anticrm/server-core'
import { createServerStorage } from '@anticrm/server-core'
import { start as startJsonRpc } from '@anticrm/server-ws'

import { addLocation } from '@anticrm/platform'
import { serverAttachmentId } from '@anticrm/server-attachment'
import { serverContactId } from '@anticrm/server-contact'
import { serverNotificationId } from '@anticrm/server-notification'
import { serverSettingId } from '@anticrm/server-setting'
import { serverChunterId } from '@anticrm/server-chunter'
import { serverInventoryId } from '@anticrm/server-inventory'
import { serverLeadId } from '@anticrm/server-lead'
import { serverRecruitId } from '@anticrm/server-recruit'
import { serverTaskId } from '@anticrm/server-task'
import { serverTagsId } from '@anticrm/server-tags'

import { metricsContext } from './metrics'

class NullDbAdapter implements DbAdapter {
  async init (model: Tx[]): Promise<void> {}
  async findAll <T extends Doc>(_class: Ref<Class<T>>, query: DocumentQuery<T>, options?: FindOptions<T> | undefined): Promise<FindResult<T>> { return [] }
  async tx (tx: Tx): Promise<TxResult> { return {} }
  async close (): Promise<void> {}
}

async function createNullAdapter (hierarchy: Hierarchy, url: string, db: string, modelDb: ModelDb): Promise<DbAdapter> {
  return new NullDbAdapter()
}

/**
 * @public
 */
export interface MinioConfig {
  endPoint: string
  accessKey: string
  secretKey: string
}

/**
 * @public
 */
export function start (dbUrl: string, fullTextUrl: string, minioConf: MinioConfig, port: number, host?: string): () => void {
  addLocation(serverAttachmentId, () => import('@anticrm/server-attachment-resources'))
  addLocation(serverContactId, () => import('@anticrm/server-contact-resources'))
  addLocation(serverNotificationId, () => import('@anticrm/server-notification-resources'))
  addLocation(serverSettingId, () => import('@anticrm/server-setting-resources'))
  addLocation(serverChunterId, () => import('@anticrm/server-chunter-resources'))
  addLocation(serverInventoryId, () => import('@anticrm/server-inventory-resources'))
  addLocation(serverLeadId, () => import('@anticrm/server-lead-resources'))
  addLocation(serverRecruitId, () => import('@anticrm/server-recruit-resources'))
  addLocation(serverTaskId, () => import('@anticrm/server-task-resources'))
  addLocation(serverTagsId, () => import('@anticrm/server-tags-resources'))

  return startJsonRpc(metricsContext, (workspace: string) => {
    const conf: DbConfiguration = {
      domains: {
        [DOMAIN_TX]: 'MongoTx',
        [DOMAIN_MODEL]: 'Null'
      },
      defaultAdapter: 'Mongo',
      adapters: {
        MongoTx: {
          factory: createMongoTxAdapter,
          url: dbUrl
        },
        Mongo: {
          factory: createMongoAdapter,
          url: dbUrl
        },
        Null: {
          factory: createNullAdapter,
          url: ''
        }
      },
      fulltextAdapter: {
        factory: createElasticAdapter,
        url: fullTextUrl
      },
      storageFactory: () => new MinioClient({
        ...minioConf,
        port: 9000,
        useSSL: false
      }),
      workspace
    }
    return createServerStorage(conf)
  }, port, host)
}
