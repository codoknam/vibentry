export const ENTRY_KNOWLEDGE_SOURCES = Object.freeze([
  "https://docs.playentry.org/entryjs/typedef/2024-03-15-project-data.html",
  "https://docs.playentry.org/entryjs/typedef/2024-03-15-object-data.html",
  "https://docs.playentry.org/entryjs/typedef/2024-03-15-variable-data.html",
  "https://docs.playentry.org/entryjs/file/2024-07-24-ent.html",
  "https://github.com/entrylabs/entryjs#프로젝트-project-schema",
  "https://docs.playentry.org/guide/entryjs/2016-05-22-add_new_blocks.html",
  "https://github.com/entrylabs/entryjs/blob/develop/src/playground/blocks/block_start.js",
  "https://github.com/entrylabs/entryjs/blob/develop/src/playground/blocks/block_flow.js",
  "https://github.com/entrylabs/entryjs/blob/develop/src/playground/blocks/block_moving.js",
  "https://github.com/entrylabs/entryjs/blob/develop/src/playground/blocks/block_looks.js",
  "https://github.com/entrylabs/entryjs/blob/develop/src/playground/blocks/block_variable.js",
  "https://docs.playentry.org/user/popup_object.html",
]);

// Distilled from the official EntryJS schema and block definitions above.
export const ENTRY_AUTHORING_GUIDE = String.raw`
[VIBENTRY ENTRY AUTHORING REFERENCE - 2026-07]

SOURCE PRIORITY
1. Preserve the supplied current project and its working IDs/assets.
2. Follow this reference, which is distilled from the official EntryJS project schema and block source.
3. Use only the verified block types supplied by the application. Never invent a block type or parameter order.

PROJECT MODEL
- A complete project keeps objects, scenes, variables, messages, functions, tables, interface and speed.
- Every object has a unique id, a valid scene id, objectType (normally "sprite"), a JSON-string script, entity, sprite, and selectedPictureId.
- selectedPictureId must equal an id in sprite.pictures. A picture needs id, name, fileurl and positive dimension width/height.
- interface.object must refer to an existing object. Every referenced scene, variable, list, message, function, object and picture ID must exist.
- Objects may be freely added or deleted, but deleting one also requires repairing interface.object and all references.
- A normal variable belongs in variables with variableType:"variable". A list ALSO belongs in variables, with variableType:"list" and array:[{data:"value"}]. A list never belongs in tables.
- Local variables use object:<object id>; global variables use object:null.
- Cloud data uses isCloud:true. Use isRealTime:true only when the current project/version supports it. Cloud behavior requires an Entry account/network/project context; an offline .ent file alone cannot promise cross-user persistence.

ASSET MODEL
- Never invent an uploaded asset path. Keep an existing valid picture until the application fulfills asset_requests.
- The application embeds generated images using Entry's official sharded layout: fileId[0..2]/fileId[2..4]/image/fileId.ext and a matching thumb path inside the temp archive.
- Request a custom image whenever the user's requested object should not visibly remain as an unrelated template character.
- Make each asset prompt self-contained: subject, view, silhouette, palette, background/transparency, and game readability.

SCRIPT MODEL
- object.script and function.content are JSON.stringify(twoDimensionalThreads). Example: [[eventBlock, actionBlock, actionBlock], [anotherEvent, action]].
- An event starts a thread. Actions after it are sibling elements in that same thread. Event blocks have statements:[]; NEVER nest their actions inside event.statements.
- Only container blocks put executable blocks in statements: repeat_basic/repeat_inf/_if use statements[0]; if_else uses statements[0] for true and statements[1] for false.
- Reporter/value/boolean blocks are nested directly inside params. They are not separate action blocks in the thread.
- Every block, including a nested value block, needs a globally unique id, a real type, params:[], and statements:[]. Keep x/y on top-level blocks; nested values may use x:0,y:0.
- Use the block's full default parameter shape, including null indicator slots. Literal values are blocks such as {type:"number",params:["1"]} and {type:"text",params:["hello"]}.

VERIFIED COMMON SIGNATURES (array indexes are exact)
- when_run_button_click [null]
- when_object_click [null]
- when_some_key_pressed [null, keyCodeString] (Space 32, Up 38, W 87)
- when_message_cast [null, messageId]
- message_cast [messageId, null]
- number [numericString]
- text [string]
- get_variable [variableId]
- set_variable [variableId, valueBlock, null]
- change_variable [variableId, valueBlock, null]
- show_variable / hide_variable [variableId, null]
- add_value_to_list [valueBlock, listId, null]
- remove_value_from_list [indexBlock, listId, null]
- insert_value_to_list [valueBlock, listId, indexBlock, null]
- change_value_list_index [listId, indexBlock, valueBlock, null]
- value_of_index_from_list [null, listId, null, indexBlock, null]
- length_of_list [null, listId, null]
- is_included_in_list [null, listId, null, valueBlock, null]
- show_list / hide_list [listId, null]
- wait_second [secondsBlock, null]
- repeat_basic [countBlock, null] with statements:[body]
- repeat_inf [null] with statements:[body]
- _if [booleanBlock, null] with statements:[trueBody]
- if_else [booleanBlock, null] with statements:[trueBody,falseBody]
- show / hide / remove_dialog [null]
- dialog [textBlock, null, null]
- dialog_time [textBlock, secondsBlock, null, null]
- move_x / move_y [numberBlock, null]
- locate_xy [xNumberBlock, yNumberBlock, null]
- rotate_relative [angleBlock, null]

RELIABLE CONSTRUCTION PATTERNS
- Counter click thread: when_object_click -> change_variable [scoreId, number("1"), null] -> add_value_to_list [get_variable(scoreId), historyListId, null].
- Initialization thread: when_run_button_click -> set_variable -> optional show_variable/show_list. Do not reset a cloud value if the user wants it preserved between visits.
- Keyboard controls use one thread per key event. Continuous controls use when_run_button_click -> repeat_inf and an _if with is_press_some_key inside.
- A button must have a button-like picture or generated asset; do not rename Entrybot to "button" while retaining an unrelated Entrybot picture.
- Runtime efficiency: prefer one clear game loop over duplicated loops, reuse signals and variables, avoid unbounded clone creation, and insert a small wait in non-frame-critical infinite loops.

FINAL SELF-CHECK BEFORE RESPONDING
- Verify unique IDs recursively, valid references, selected pictures, object count, and scene membership.
- Parse every script string back to a 2D array.
- Verify each event is the first block of its thread and has no statement body.
- Verify every list is variableType:"list" with array and every list block points to that list's id at the exact index above.
- Verify value inputs are nested blocks in the correct parameter slot, not null or shifted into an indicator slot.
- Return the full project, not a partial patch, and explain any genuine Entry/cloud limitation in Korean.
`;

export function entryKnowledgePrompt() {
  return `${ENTRY_AUTHORING_GUIDE}\n\n[OFFICIAL REFERENCE URLS]\n${ENTRY_KNOWLEDGE_SOURCES.join("\n")}`;
}
