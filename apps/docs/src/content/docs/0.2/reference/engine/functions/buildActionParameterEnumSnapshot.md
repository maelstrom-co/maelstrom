---
editUrl: false
next: false
prev: false
title: "buildActionParameterEnumSnapshot"
---

> **buildActionParameterEnumSnapshot**(`vessels`): [`ActionParameterEnumSnapshot`](/reference/engine/interfaces/actionparameterenumsnapshot/)

Defined in: packages/engine/src/lib/action-parameter-enum.ts:66

Normalizes every Action enum once for one Engine request.

The snapshot is detached from author-owned enum objects and recursively
frozen. A parameter object reused by reference is still normalized once.
Duplicate parameter names and declarations above the protocol's candidate
ceiling throw before prompt construction or adapter invocation. Empty or
fully filtered enums remain unconstrained beyond the declared type.

## Parameters

### vessels

readonly `object`[]

## Returns

[`ActionParameterEnumSnapshot`](/reference/engine/interfaces/actionparameterenumsnapshot/)
