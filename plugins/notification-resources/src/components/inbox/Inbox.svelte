<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import notification, { DocNotifyContext, InboxNotification } from '@hcengineering/notification'
  import { ActionContext, getClient } from '@hcengineering/presentation'
  import view from '@hcengineering/view'
  import {
    AnyComponent,
    ButtonWithDropdown,
    Component,
    defineSeparators,
    IconDropdown,
    Label,
    location as locationStore,
    Location,
    Scroller,
    Separator,
    TabItem,
    TabList
  } from '@hcengineering/ui'
  import chunter, { ThreadMessage } from '@hcengineering/chunter'
  import { Account, getCurrentAccount, IdMap, Ref } from '@hcengineering/core'
  import activity, { ActivityMessage } from '@hcengineering/activity'
  import { isReactionMessage } from '@hcengineering/activity-resources'
  import { get } from 'svelte/store'
  import { translate } from '@hcengineering/platform'

  import { InboxNotificationsClientImpl } from '../../inboxNotificationsClient'
  import Filter from '../Filter.svelte'
  import { archiveAll, getDisplayInboxData, openInboxDoc, readAll, resolveLocation, unreadAll } from '../../utils'
  import { InboxData, InboxNotificationsFilter } from '../../types'
  import InboxGroupedListView from './InboxGroupedListView.svelte'

  export let visibleNav: boolean = true
  export let navFloat: boolean = false
  export let appsDirection: 'vertical' | 'horizontal' = 'horizontal'

  const client = getClient()
  const hierarchy = client.getHierarchy()

  const inboxClient = InboxNotificationsClientImpl.getClient()
  const notificationsByContextStore = inboxClient.inboxNotificationsByContext
  const contextByIdStore = inboxClient.contextById
  const contextsStore = inboxClient.contexts

  const allTab: TabItem = {
    id: 'all',
    labelIntl: notification.string.All
  }

  let inboxData: InboxData = new Map()

  let filteredData: InboxData = new Map()
  let filter: InboxNotificationsFilter = 'all'

  let tabItems: TabItem[] = []
  let selectedTabId: string = allTab.id

  let selectedContextId: Ref<DocNotifyContext> | undefined = undefined
  let selectedContext: DocNotifyContext | undefined = undefined
  let selectedComponent: AnyComponent | undefined = undefined

  let selectedMessage: ActivityMessage | undefined = undefined

  $: void getDisplayInboxData($notificationsByContextStore).then((res) => {
    inboxData = res
  })

  $: filteredData = filterData(filter, selectedTabId, inboxData, $contextByIdStore)

  locationStore.subscribe((newLocation) => {
    void syncLocation(newLocation)
  })

  async function syncLocation (newLocation: Location): Promise<void> {
    const loc = await resolveLocation(newLocation)

    selectedContextId = loc?.loc.path[3] as Ref<DocNotifyContext> | undefined

    if (selectedContextId !== selectedContext?._id) {
      selectedContext = undefined
    }

    const selectedMessageId = loc?.loc.query?.message as Ref<ActivityMessage> | undefined

    if (selectedMessageId !== undefined) {
      selectedMessage = get(inboxClient.activityInboxNotifications).find(
        ({ attachedTo }) => attachedTo === selectedMessageId
      )?.$lookup?.attachedTo
      if (selectedMessage === undefined) {
        selectedMessage = await client.findOne(activity.class.ActivityMessage, { _id: selectedMessageId })
      }
    }
  }

  $: selectedContext = selectedContextId ? selectedContext ?? $contextByIdStore.get(selectedContextId) : undefined

  $: void updateSelectedPanel(selectedContext)
  $: void updateTabItems(inboxData, $contextsStore)

  async function updateTabItems (inboxData: InboxData, notifyContexts: DocNotifyContext[]): Promise<void> {
    const displayClasses = new Set(
      notifyContexts.filter(({ _id }) => inboxData.has(_id)).map(({ attachedToClass }) => attachedToClass)
    )

    const classes = Array.from(displayClasses)
    const tabs: TabItem[] = []

    let messagesTab: TabItem | undefined = undefined

    for (const _class of classes) {
      if (hierarchy.isDerived(_class, activity.class.ActivityMessage)) {
        if (messagesTab === undefined) {
          messagesTab = {
            id: activity.class.ActivityMessage as string,
            label: await translate(activity.string.Messages, {})
          }
        }
        continue
      }

      const clazz = hierarchy.getClass(_class)
      const intlLabel = clazz.pluralLabel ?? clazz.label ?? _class
      tabs.push({
        id: _class,
        label: await translate(intlLabel, {})
      })
    }

    if (messagesTab !== undefined) {
      tabs.push(messagesTab)
    }

    tabItems = [allTab].concat(tabs.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')))
  }

  function selectTab (event: CustomEvent): void {
    if (event.detail !== undefined) {
      selectedTabId = event.detail.id
    }
  }

  async function selectContext (event?: CustomEvent): Promise<void> {
    selectedContext = event?.detail?.context
    selectedContextId = selectedContext?._id

    if (selectedContext === undefined) {
      openInboxDoc()
      return
    }

    if (hierarchy.isDerived(selectedContext.attachedToClass, activity.class.ActivityMessage)) {
      const message = event?.detail?.notification?.$lookup?.attachedTo

      if (selectedContext.attachedToClass === chunter.class.ThreadMessage) {
        const thread = await client.findOne(chunter.class.ThreadMessage, {
          _id: selectedContext.attachedTo as Ref<ThreadMessage>
        })
        openInboxDoc(selectedContext._id, thread?.attachedTo, thread?._id)
      } else if (isReactionMessage(message)) {
        openInboxDoc(selectedContext._id, undefined, selectedContext.attachedTo as Ref<ActivityMessage>)
      } else {
        const selectedMsg = event?.detail?.notification?.attachedTo

        openInboxDoc(
          selectedContext._id,
          selectedMsg ? (selectedContext.attachedTo as Ref<ActivityMessage>) : undefined,
          selectedMsg ?? (selectedContext.attachedTo as Ref<ActivityMessage>)
        )
      }
    } else {
      openInboxDoc(selectedContext._id, undefined, event?.detail?.notification?.attachedTo)
    }
  }

  async function updateSelectedPanel (selectedContext?: DocNotifyContext): Promise<void> {
    if (selectedContext === undefined) {
      selectedComponent = undefined
      return
    }

    const isChunterChannel = hierarchy.isDerived(selectedContext.attachedToClass, chunter.class.ChunterSpace)
    const panelComponent = hierarchy.classHierarchyMixin(selectedContext.attachedToClass, view.mixin.ObjectPanel)

    selectedComponent = panelComponent?.component ?? view.component.EditDoc

    const contextNotifications = $notificationsByContextStore.get(selectedContext._id) ?? []

    const doneOp = await getClient().measure('readNotifications')
    const ops = getClient().apply(selectedContext._id)
    try {
      await inboxClient.readNotifications(
        ops,
        contextNotifications
          .filter(({ _class, isViewed }) =>
            isChunterChannel ? _class === notification.class.CommonInboxNotification : !isViewed
          )
          .map(({ _id }) => _id)
      )
    } finally {
      await ops.commit()
      await doneOp()
    }
  }

  function filterNotifications (
    filter: InboxNotificationsFilter,
    notifications: InboxNotification[]
  ): InboxNotification[] {
    switch (filter) {
      case 'unread':
        return notifications.filter(({ isViewed }) => !isViewed)
      case 'read':
        return notifications.filter(({ isViewed }) => isViewed)
      case 'all':
        return notifications
    }
  }

  function filterData (
    filter: InboxNotificationsFilter,
    selectedTabId: string,
    inboxData: InboxData,
    contextById: IdMap<DocNotifyContext>
  ): InboxData {
    if (selectedTabId === allTab.id && filter === 'all') {
      return inboxData
    }

    const result = new Map()

    for (const [key, notifications] of inboxData) {
      const resNotifications = filterNotifications(filter, notifications)

      if (resNotifications.length === 0) {
        continue
      }

      if (selectedTabId === allTab.id) {
        result.set(key, resNotifications)
        continue
      }

      const context = contextById.get(key)

      if (context === undefined) {
        continue
      }

      if (
        selectedTabId === activity.class.ActivityMessage &&
        hierarchy.isDerived(context.attachedToClass, activity.class.ActivityMessage)
      ) {
        result.set(key, resNotifications)
      } else if (context.attachedToClass === selectedTabId) {
        result.set(key, resNotifications)
      }
    }

    return result
  }

  defineSeparators('inbox', [
    { minSize: 20, maxSize: 50, size: 40, float: 'navigator' },
    { size: 'auto', minSize: 30, maxSize: 'auto', float: undefined }
  ])

  async function dropdownItemSelected (id: 'archive' | 'read' | 'unread'): Promise<void> {
    if (id == null) return

    if (id === 'archive') {
      void archiveAll()
    }

    if (id === 'read') {
      void readAll()
    }

    if (id === 'unread') {
      void unreadAll()
    }
  }
</script>

<ActionContext
  context={{
    mode: 'browser'
  }}
/>

<div class="flex-row-top h-full">
  {#if visibleNav}
    <div
      class="antiPanel-navigator {appsDirection === 'horizontal'
        ? 'portrait'
        : 'landscape'} background-comp-header-color"
    >
      <div class="antiPanel-wrap__content">
        <div class="ac-header full divide caption-height" style:padding="0.5rem var(--spacing-1_5)">
          <div class="ac-header__wrap-title mr-3">
            <span class="title"><Label label={notification.string.Inbox} /></span>
          </div>
          <div class="flex flex-gap-2">
            {#if inboxData.size > 0}
              <ButtonWithDropdown
                justify="left"
                kind="regular"
                label={notification.string.MarkReadAll}
                icon={notification.icon.ReadAll}
                on:click={readAll}
                dropdownItems={[
                  {
                    id: 'read',
                    icon: notification.icon.ReadAll,
                    label: notification.string.MarkReadAll
                  },
                  {
                    id: 'unread',
                    icon: notification.icon.UnreadAll,
                    label: notification.string.MarkUnreadAll
                  },
                  {
                    id: 'archive',
                    icon: view.icon.Archive,
                    label: notification.string.ArchiveAll
                  }
                ]}
                dropdownIcon={IconDropdown}
                on:dropdown-selected={(ev) => dropdownItemSelected(ev.detail)}
              />
            {/if}
            <Filter bind:filter />
          </div>
        </div>

        <div class="tabs">
          <TabList items={tabItems} selected={selectedTabId} on:select={selectTab} />
        </div>

        <Scroller padding="0">
          <InboxGroupedListView data={filteredData} selectedContext={selectedContextId} on:click={selectContext} />
        </Scroller>
      </div>
      <Separator name="inbox" float={navFloat ? 'navigator' : true} index={0} />
    </div>
    <Separator name="inbox" float={navFloat} index={0} />
  {/if}
  <div class="antiPanel-component filled w-full">
    {#if selectedContext && selectedComponent}
      <Component
        is={selectedComponent}
        props={{
          _id: selectedContext.attachedTo,
          _class: selectedContext.attachedToClass,
          context: selectedContext,
          activityMessage: selectedMessage,
          props: { context: selectedContext }
        }}
        on:close={() => selectContext(undefined)}
      />
    {/if}
  </div>
</div>

<style lang="scss">
  .tabs {
    display: flex;
    margin-top: 0.5rem;
    margin-bottom: 0;
    padding: 0 var(--spacing-1_5);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--theme-navpanel-border);
  }

  .title {
    font-weight: 600;
    font-size: 1.25rem;
    color: var(--global-primary-TextColor);
  }
</style>
