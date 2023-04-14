import { Variant } from '../../types'
import { stripIndent } from '../../utils/formatters'
import { expectResult } from '../../utils/testing'

const variant = { variant: Variant.DEFAULT }

test('Variable declaration and assignment', () => {
    return expectResult(
        stripIndent`
        let x = 1;
        let y = 1;
        let z = x + y;
        z
    `,
        variant
    ).toMatchInlineSnapshot(`2`)
})

test('Variable type reassignment', () => {
    return expectResult(
        stripIndent`
        let x = 1;
        x = 'a';
        x
    `,
        variant
    ).toMatchInlineSnapshot(`"a"`)
})

test('Pointer declaration and assignment', () => {
    return expectResult(
        stripIndent`
        let x = 1;
        let *y = &x;
        *y
    `,
        variant
    ).toMatchInlineSnapshot(`1`)
})

test('Pointer arithmetic (& and *)', () => {
    return expectResult(
        stripIndent`
        let x = 1;
        let y = 2;
        let *z;
        z = &y;
        *z
    `,
        variant
    ).toMatchInlineSnapshot(`2`)
})


test('Conditional statements', () => {
    return expectResult(
        stripIndent`
        let x = 1;
        let y = 2;
        let z = 4;
        if (x > y) {
            z = 5;
        }
        z
    `,
        variant
    ).toMatchInlineSnapshot(`4`)
})

test('Loops', () => {
    return expectResult(
        stripIndent`
        let x = 0;
        for (let j = 0; j < 10; j++) {
            x++;
        }
        x
    `,
        variant
    ).toMatchInlineSnapshot(`10`)
})

test('Function declaration and invocation', () => {
    return expectResult(
        stripIndent`
        function fact(x) {
            if (x == 0) {
                return 1;
            }
            return x * fact(x - 1);
        }
        fact(5)
    `,
        variant
    ).toMatchInlineSnapshot(`120`)
})

test('Array declaration and access', () => {
    return expectResult(
        stripIndent`
        let x[][] = {{1, 2}, {3, 4}, {5, 6}};
        let sum = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 2; j++) {
                sum += x[i][j];
            }
        }
        sum // 1+2+3+4+5+6=21
    `,
        variant
    ).toMatchInlineSnapshot(`21`)
})

test('Array declaration and access with pointer arithmetic', () => {
    return expectResult(
        stripIndent`
        let x[][] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
        *(*(x + 2) + 2)
    `,
        variant
    ).toMatchInlineSnapshot(`9`)
})

test('Heap', () => {
    return expectResult(
        stripIndent`
        let word_size = 8;
        let *x = malloc(10*word_size);
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            x[i] = 1;
            sum += x[i];
        }
        sum
    `,
        variant
    ).toMatchInlineSnapshot(`10`)
})
