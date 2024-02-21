import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Container, HStack, Heading, Stack } from '@chakra-ui/react';
import { Form, Formik } from 'formik';
import React, { useEffect, useState } from 'react';
import { InputField } from '../components/InputField';
import { useForgotPasswordMutation } from '../gql/generated/graphql';


const ForgotPassword: React.FC<{}> = ({ }) => {
    const [domLoaded, setDomLoaded] = useState(false);
    const [forgotPassword] = useForgotPasswordMutation();
    const [complete, setComplete] = useState(false)

    useEffect(() => {
        setDomLoaded(true);
    }, []);
    return (
        <>
            {domLoaded ?
                <Container maxW="lg" py={{ base: '12', md: '24' }} px={{ base: '0', sm: '8' }}>
                    <Stack spacing="8">
                        <Stack spacing="6">
                            <Stack spacing={{ base: '2', md: '3' }} textAlign="center">
                                <Heading size={{ base: 'lg', md: '2xl' }}>Forogt Password</Heading>
                            </Stack>
                        </Stack>
                        <Box
                            py={{ base: '0', sm: '8' }}
                            px={{ base: '4', sm: '10' }}
                            bg={{ base: 'transparent', sm: 'bg.surface' }}
                            boxShadow={{ base: 'none', sm: 'md' }}
                            borderRadius={{ base: 'none', sm: 'xl' }}
                        >
                            <Formik initialValues={{ email: "" }} onSubmit={async (values) => {
                                await forgotPassword({ variables: values });
                                setComplete(true);
                            }}>
                                {({ isSubmitting }) => complete ?
                                    (
                                        <Alert variant='subtle'
                                            flexDirection='column'
                                            alignItems='center'
                                            justifyContent='center'
                                            textAlign='center'
                                            height='200px'
                                            rounded={"md"}
                                            status='info'>
                                            <AlertIcon />
                                            Email sent to the specified email
                                        </Alert>
                                    ) : (
                                        <Form>
                                            <Stack spacing="6">
                                                <Stack spacing="5">
                                                    <InputField name='email' placeholder='bob@bob.com' label='Email' />
                                                </Stack>
                                                <HStack justify="space-between">
                                                </HStack>
                                                <Stack spacing="6">
                                                    <Button type='submit' colorScheme={'teal'} isLoading={isSubmitting}>Forgot Password</Button>
                                                </Stack>
                                            </Stack>
                                        </Form>
                                    )}
                            </Formik>
                        </Box>
                    </Stack>
                </Container> : null}</>
    );
}

export default ForgotPassword;