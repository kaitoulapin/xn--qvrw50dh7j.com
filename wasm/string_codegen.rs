use proc_macro2::{Delimiter, Group, TokenStream, TokenTree};
use quote::{ToTokens, quote};
use std::collections::HashMap;
use syn::{Expr, Lit, Pat, parse_quote, visit_mut::VisitMut};

#[derive(Default)]
pub struct Strings {
    pub values: Vec<String>,
    ids: HashMap<String, usize>,
}
impl Strings {
    fn id(&mut self, value: String) -> usize {
        if let Some(id) = self.ids.get(&value) {
            return *id;
        }
        let id = self.values.len();
        self.ids.insert(value.clone(), id);
        self.values.push(value);
        id
    }
    fn tokens(&mut self, stream: TokenStream, format: bool, patterns: bool) -> TokenStream {
        let input: Vec<_> = stream.into_iter().collect();
        let mut out = TokenStream::new();
        let mut i = 0;
        while i < input.len() {
            if let (
                Some(TokenTree::Ident(name)),
                Some(TokenTree::Punct(bang)),
                Some(TokenTree::Group(group)),
            ) = (input.get(i), input.get(i + 1), input.get(i + 2))
            {
                if bang.as_char() == '!' {
                    let name_string = name.to_string();
                    let body = self.tokens(
                        group.stream(),
                        name_string == "format",
                        name_string == "matches",
                    );
                    out.extend([
                        input[i].clone(),
                        input[i + 1].clone(),
                        TokenTree::Group(Group::new(group.delimiter(), body)),
                    ]);
                    i += 3;
                    continue;
                }
            }
            let token = match &input[i] {
                TokenTree::Literal(literal) if !(format && i == 0) && !patterns => {
                    if let Ok(Lit::Str(value)) = syn::parse_str::<Lit>(&literal.to_string()) {
                        let id = self.id(value.value());
                        TokenTree::Group(Group::new(
                            Delimiter::Parenthesis,
                            quote!(crate::data::text(#id)),
                        ))
                    } else {
                        input[i].clone()
                    }
                }
                TokenTree::Group(group) => TokenTree::Group(Group::new(
                    group.delimiter(),
                    self.tokens(group.stream(), false, patterns),
                )),
                _ => input[i].clone(),
            };
            out.extend([token]);
            i += 1;
        }
        out
    }
}
fn strings_in_pattern(pattern: &Pat) -> Option<Vec<String>> {
    match pattern {
        Pat::Lit(value) => {
            if let Lit::Str(value) = &value.lit {
                Some(vec![value.value()])
            } else {
                None
            }
        }
        Pat::Or(value) => value
            .cases
            .iter()
            .map(strings_in_pattern)
            .collect::<Option<Vec<_>>>()
            .map(|groups| groups.into_iter().flatten().collect()),
        _ => None,
    }
}
impl VisitMut for Strings {
    fn visit_expr_mut(&mut self, expression: &mut Expr) {
        if let Expr::Lit(value) = expression {
            if let Lit::Str(value) = &value.lit {
                let id = self.id(value.value());
                *expression = parse_quote!(crate::data::text(#id));
                return;
            }
        }
        syn::visit_mut::visit_expr_mut(self, expression);
    }
    fn visit_macro_mut(&mut self, value: &mut syn::Macro) {
        let name = value.path.segments.last().unwrap().ident.to_string();
        value.tokens = self.tokens(value.tokens.clone(), name == "format", name == "matches");
    }
    fn visit_arm_mut(&mut self, arm: &mut syn::Arm) {
        if let Some(values) = strings_in_pattern(&arm.pat) {
            let ids: Vec<_> = values.into_iter().map(|s| self.id(s)).collect();
            let mut guard: Expr =
                parse_quote!(false #( || __aha_pattern == crate::data::text(#ids) )*);
            if let Some((_, old)) = arm.guard.take() {
                guard = parse_quote!((#guard) && (#old));
            }
            arm.pat = parse_quote!(__aha_pattern);
            arm.guard = Some((Default::default(), Box::new(guard)));
        }
        syn::visit_mut::visit_arm_mut(self, arm);
    }
}
pub fn generate(source: &str, strings: &mut Strings) -> String {
    let mut file = syn::parse_file(source).expect("Invalid Rust source");
    strings.visit_file_mut(&mut file);
    file.into_token_stream().to_string()
}
