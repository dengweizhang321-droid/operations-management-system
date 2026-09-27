"""Narrow pg_dump/pg_restore equivalences, not general SQL normalization."""
from __future__ import annotations

import re
import json

_LITERAL = r"'(?:''|[^'])*'"
_VARCHAR_LITERAL = _LITERAL + r"::character varying"
_VARCHAR_ARRAY_TO_TEXT = re.compile(
    r"\(ARRAY\[(?P<items>" + _VARCHAR_LITERAL
    + r"(?:, " + _VARCHAR_LITERAL + r")*)\]\)::text\[\]")
_SCALAR_VARCHAR_TO_TEXT = re.compile(r"\((" + _VARCHAR_LITERAL + r")\)::text")


def _quoted_positions(source):
    quoted = set()
    index = 0
    while index < len(source):
        if source[index] not in ("'", '"'):
            index += 1
            continue
        quote = source[index]
        start = index
        escaped = quote == "'" and index > 0 and source[index - 1] in "eE"
        index += 1
        while index < len(source):
            if escaped and source[index] == "\\":
                index += 2
            elif source[index] == quote:
                if index + 1 < len(source) and source[index + 1] == quote:
                    index += 2
                else:
                    index += 1
                    break
            else:
                index += 1
        quoted.update(range(start, index))
    return quoted


def _replace_code(pattern, replacement, source):
    """Do not interpret SQL-like text inside literals or quoted identifiers."""
    quoted = _quoted_positions(source)
    return pattern.sub(lambda match: match.group(0) if match.start() in quoted
        else replacement(match), source)


def _boolean_tree(expression):
    """Only associative AND/OR grouping; operands and their order stay exact."""
    expression = expression.strip()
    protected = _quoted_positions(expression)
    depth = 0
    closes = []
    for index, char in enumerate(expression):
        if index in protected:
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                closes.append(index)
        if depth < 0:
            return ("atom", expression)
    if depth:
        return ("atom", expression)
    if expression.startswith("(") and closes and closes[0] == len(expression) - 1:
        return _boolean_tree(expression[1:-1])
    # pg_get_constraintdef expands BETWEEN, but unknown SQL is kept opaque.
    if any(token in expression for token in (" BETWEEN ", "CASE ", " WHEN ")):
        return ("atom", expression)
    for operator in ("OR", "AND"):
        delimiter = " " + operator + " "
        parts, start, depth = [], 0, 0
        for index, char in enumerate(expression):
            if index in protected:
                continue
            if char in "([":
                depth += 1
            elif char in ")]":
                depth -= 1
            elif depth == 0 and expression.startswith(delimiter, index):
                parts.append(expression[start:index])
                start = index + len(delimiter)
        if parts:
            parts.append(expression[start:])
            children = []
            for part in parts:
                child = _boolean_tree(part)
                children.extend(child[1] if child[0] == operator else [child])
            return (operator, children)
    return ("atom", expression)


def normalize_dump_expression(definition: str) -> str:
    """Normalize constant unbounded varchar[] -> text[] parser spelling only.

    PostgreSQL can distribute an array cast into individual scalar casts when
    re-parsing pg_dump's SQL. Literal bytes, order, predicates, operators and
    all other casts remain part of the checked expression.
    """
    if not isinstance(definition, str):
        raise TypeError("catalog definition must be text")
    def array(match):
        items = re.sub(_VARCHAR_LITERAL, lambda item:
            item.group(0).removesuffix("::character varying") + "::text", match.group("items"))
        return "ARRAY[" + items + "]"
    result = _replace_code(_VARCHAR_ARRAY_TO_TEXT, array, definition)
    result = _replace_code(_SCALAR_VARCHAR_TO_TEXT,
        lambda match: match.group(1).removesuffix("::character varying") + "::text",
        result)
    if result.startswith("CHECK (") and result.endswith(")"):
        return "CHECK-TREE " + json.dumps(_boolean_tree(result[6:]),
            separators=(",", ":"), ensure_ascii=True)
    return result
